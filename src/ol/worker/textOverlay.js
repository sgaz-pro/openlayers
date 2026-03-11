/**
 * A worker that does cpu-heavy tasks related to webgl rendering.
 * @module ol/worker/textOverlay
 */

import {newParsingContext} from '../expr/expression.js';
import Executor from '../render/canvas/Executor.js';
import TextBuilder from '../render/canvas/TextBuilder.js';
import {flatStyleLikeToStyleFunction} from '../render/canvas/style.js';
import {TextOverlayWorkerMessageType} from '../render/webgl/constants.js';
import {deserializeFrameState} from '../render/webgl/serialize.js';
import {
  convertLineStringRenderInstructionsToCanvasTextBuilder,
  convertPointRenderInstructionsToCanvasTextBuilder,
  convertPolygonRenderInstructionsToCanvasTextBuilder,
  stripNonTextStyleProperties,
} from '../render/webgl/textUtil.js';
import {
  compose as composeTransform,
  create as createTransform,
  invert as invertTransform,
  multiply as multiplyTransform,
} from '../transform.js';

/** @type {any} */
const worker = self;

let textRenderAnimationFrameKey = 0;
let textRenderInProgress = false;
const pendingRenders = [];
let lastRenderedRenderBatchKey = null;

const canvas = new OffscreenCanvas(1, 1);
const context = canvas.getContext('2d');

/**
 * @typedef {Object} RenderBatch
 * @property {import('../transform.js').Transform} inverseTransform Inverse of transform in which coordinates are expressed
 * @property {import('../render/canvas/Executor.js').default} executor Executor containing instructions
 */

/**
 * This holds all constructed render batches
 * If the value is null, it means the render batch has been processed but no text instruction was needed there
 * @type {Map<string, RenderBatch|null>}
 */
const renderBatches = new Map();

/**
 * Current render batch key requested by the main thread.
 * @type {string|null}
 */
let activeRenderBatchKey = null;

const tmpTransform = createTransform();

function getRenderTransform(
  center,
  resolution,
  rotation,
  pixelRatio,
  width,
  height,
  offsetX,
) {
  const dx1 = width / 2;
  const dy1 = height / 2;
  const sx = pixelRatio / resolution;
  const sy = -sx;
  const dx2 = -center[0] + offsetX;
  const dy2 = -center[1];
  return composeTransform(tmpTransform, dx1, dy1, sx, sy, -rotation, dx2, dy2);
}

function scheduleTextRender() {
  if (
    textRenderAnimationFrameKey ||
    textRenderInProgress ||
    !pendingRenders.length
  ) {
    return;
  }

  textRenderAnimationFrameKey = requestAnimationFrame(() => {
    textRenderAnimationFrameKey = 0;
    textRenderInProgress = true;

    const renderJob = pendingRenders.shift();
    if (!renderJob) {
      textRenderInProgress = false;
      scheduleTextRender();
      return;
    }

    const {id, frameState: frameStateSerialized, renderBatchKey} = renderJob;
    const frameState = deserializeFrameState(frameStateSerialized);
    const viewState = frameState.viewState;

    // either resize or clear
    if (
      frameState.size[0] !== canvas.width ||
      frameState.size[1] !== canvas.height
    ) {
      canvas.width = frameState.size[0];
      canvas.height = frameState.size[1];
    } else {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }

    if (renderBatchKey) {
      if (!renderBatches.has(renderBatchKey)) {
        console.warn('Unknown render batch key ', renderBatchKey); // TODO: this should not happen, maybe throw here?
      } else {
        const renderBatch = renderBatches.get(renderBatchKey);
        if (renderBatch) {
          const transform = getRenderTransform(
            viewState.center,
            viewState.resolution,
            0,
            frameState.pixelRatio,
            canvas.width,
            canvas.height,
            0,
          );
          multiplyTransform(transform, renderBatch.inverseTransform);

          renderBatch.executor.execute(
            context,
            frameState.size,
            transform,
            frameState.viewState.rotation,
            false,
          );
        }
      }
    }

    const imageData = canvas.transferToImageBitmap();

    /** @type {import('../render/webgl/constants.js').TextOverlayWorkerMessage} */
    const message = {
      type: TextOverlayWorkerMessageType.RENDER,
      imageData,
      frameState: frameStateSerialized,
      id,
    };
    worker.postMessage(message, [imageData]);

    textRenderInProgress = false;
    scheduleTextRender();
  });
}

function enqueueTextRender(id, frameStateSerialized) {
  let renderBatchKeyToRender =
    activeRenderBatchKey && renderBatches.has(activeRenderBatchKey)
      ? activeRenderBatchKey
      : null;

  // Reuse the last rendered batch when render requests briefly outrun
  // SET_RENDER_BATCH messages during animation.
  if (!renderBatchKeyToRender) {
    renderBatchKeyToRender =
      lastRenderedRenderBatchKey &&
      renderBatches.has(lastRenderedRenderBatchKey)
        ? lastRenderedRenderBatchKey
        : null;
  }
  if (renderBatchKeyToRender) {
    lastRenderedRenderBatchKey = renderBatchKeyToRender;
  }

  const renderJob = {
    id,
    frameState: frameStateSerialized,
    renderBatchKey: renderBatchKeyToRender,
  };
  if (pendingRenders.length) {
    pendingRenders[pendingRenders.length - 1] = renderJob;
  } else {
    pendingRenders.push(renderJob);
  }
  scheduleTextRender();
}

worker.onmessage = (event) => {
  const received = event.data;
  switch (received.type) {
    case TextOverlayWorkerMessageType.SET_RENDER_BATCH: {
      const {instructionsSetKey} = received;
      activeRenderBatchKey = instructionsSetKey;
      break;
    }

    case TextOverlayWorkerMessageType.RENDER: {
      enqueueTextRender(received.id, received.frameState);
      break;
    }

    case TextOverlayWorkerMessageType.BUILD_INSTRUCTIONS: {
      console.time('BUILD_INSTRUCTIONS');
      const {
        polygonRenderInstructions,
        lineStringRenderInstructions,
        pointRenderInstructions,
        style,
        customAttributesSizes,
        renderInstructionsTransform,
        id,
        // TODO: view projection
      } = received;
      const resolution = 1;
      const pixelRatio = 1;
      const instructionsSetKey = Date.now().toString();
      const labelsArray = new Uint8Array(received.labelsArray);
      const builder = new TextBuilder(
        1,
        [-Infinity, -Infinity, Infinity, Infinity],
        resolution,
        pixelRatio,
      );

      const parsingContext = newParsingContext();
      stripNonTextStyleProperties(style);
      const styleFn = flatStyleLikeToStyleFunction(style, parsingContext);

      console.timeLog('BUILD_INSTRUCTIONS', '/ converted style to styleFn');

      convertPolygonRenderInstructionsToCanvasTextBuilder(
        new Float32Array(polygonRenderInstructions),
        labelsArray,
        parsingContext.properties,
        customAttributesSizes,
        builder,
        styleFn,
      );
      console.timeLog('BUILD_INSTRUCTIONS', '/ parsed polygon instructions');
      convertLineStringRenderInstructionsToCanvasTextBuilder(
        new Float32Array(lineStringRenderInstructions),
        renderInstructionsTransform,
        labelsArray,
        parsingContext.properties,
        customAttributesSizes,
        builder,
        styleFn,
      );
      console.timeLog('BUILD_INSTRUCTIONS', '/ parsed lineString instructions');
      convertPointRenderInstructionsToCanvasTextBuilder(
        new Float32Array(pointRenderInstructions),
        renderInstructionsTransform,
        labelsArray,
        parsingContext.properties,
        customAttributesSizes,
        builder,
        styleFn,
      );
      console.timeLog('BUILD_INSTRUCTIONS', '/ parsed point instructions');

      const canvasInstructions = builder.finish();

      // nothing to draw
      if (canvasInstructions.instructions.length === 0) {
        renderBatches.set(instructionsSetKey, null);
      } else {
        const inverseTransform = invertTransform(renderInstructionsTransform);
        const executor = new Executor(
          resolution,
          pixelRatio,
          false,
          canvasInstructions,
        );
        renderBatches.set(instructionsSetKey, {
          inverseTransform,
          executor,
        });
      }

      /** @type {import('../render/webgl/constants.js').TextOverlayWorkerMessage} */
      const message = {
        type: TextOverlayWorkerMessageType.BUILD_INSTRUCTIONS,
        instructionsSetKey,
        id,
      };
      worker.postMessage(message);

      console.timeEnd('BUILD_INSTRUCTIONS');
      break;
    }

    case TextOverlayWorkerMessageType.DISPOSE_INSTRUCTIONS: {
      const {instructionsSetKey} = received;
      if (renderBatches.has(instructionsSetKey)) {
        renderBatches.delete(instructionsSetKey);
      }
      if (activeRenderBatchKey === instructionsSetKey) {
        activeRenderBatchKey = null;
      }
      if (lastRenderedRenderBatchKey === instructionsSetKey) {
        lastRenderedRenderBatchKey = null;
      }
      break;
    }

    default:
    // pass
  }
};

/** @type {function(): Worker} */ export let create;

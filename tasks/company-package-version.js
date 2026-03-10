import {dirname, join} from 'path';
import process from 'process';
import {fileURLToPath} from 'url';
import esMain from 'es-main';
import fse from 'fs-extra';
import semver from 'semver';

const baseDir = dirname(fileURLToPath(import.meta.url));
const prereleaseChannel = 'webgl-text-animation';
const tagPrefix = 'sgaz-openlayers/v';

function parseVersion(version) {
  const parsed = semver.parse(version);
  if (!parsed) {
    throw new Error(`Invalid version ${version}`);
  }
  return parsed;
}

function validateCompanyVersion(version) {
  const parsed = parseVersion(version);
  if (parsed.prerelease.length < 2 || parsed.prerelease[0] !== prereleaseChannel) {
    throw new Error(
      `Version must use the "${prereleaseChannel}" prerelease channel, got ${version}`,
    );
  }
  return version;
}

async function nextCompanyVersion() {
  const pkg = await fse.readJSON(join(baseDir, '../package.json'));
  const parsed = parseVersion(pkg.version);
  return `${parsed.major}.${parsed.minor}.${parsed.patch}-${prereleaseChannel}.${Date.now()}`;
}

function versionFromTag(tag) {
  if (!tag.startsWith(tagPrefix)) {
    throw new Error(`Tag must start with ${tagPrefix}, got ${tag}`);
  }
  const version = tag.slice(tagPrefix.length);
  return validateCompanyVersion(version);
}

async function main(args) {
  const [command, value] = args;

  if (command === 'next') {
    process.stdout.write(`${await nextCompanyVersion()}\n`);
    return;
  }

  if (command === 'validate') {
    if (!value) {
      throw new Error('Missing version argument');
    }
    process.stdout.write(`${validateCompanyVersion(value)}\n`);
    return;
  }

  if (command === 'from-tag') {
    if (!value) {
      throw new Error('Missing tag argument');
    }
    process.stdout.write(`${versionFromTag(value)}\n`);
    return;
  }

  throw new Error('Usage: node tasks/company-package-version.js <next|validate|from-tag> [value]');
}

if (esMain(import.meta)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

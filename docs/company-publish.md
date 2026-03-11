# Company Package Publish

This repository can publish a company-scoped OpenLayers package without touching the official `ol` release flow.

## Package Identity

- Published package: `@sgaz-pro/openlayers`
- Source imports in downstream apps stay unchanged:

```json
{
  "dependencies": {
    "ol": "npm:@sgaz-pro/openlayers@10.8.1-webgl-text-animation.0"
  }
}
```

The root package remains `ol`. The scoped package name is applied only when `build/ol/package.json` is generated.

## Version Scheme

Company builds use the prerelease channel `webgl-text-animation`:

- manual example: `10.8.1-webgl-text-animation.0`
- auto-generated example: `10.8.1-webgl-text-animation.1741570000000`

This avoids collisions with the official `ol` versions.

## Tag Scheme

Company release tags must use the `sgaz-openlayers/` prefix:

- `sgaz-openlayers/v10.8.1-webgl-text-animation.0`

This avoids collisions with upstream tags like `v10.8.1`.

## GitHub Workflow

Workflow file: [`.github/workflows/publish-company-package.yml`](../.github/workflows/publish-company-package.yml)

It supports two modes:

1. Manual publish via `workflow_dispatch`
2. Tag-based publish on `sgaz-openlayers/v*`

### Manual Publish

Open `Actions` -> `Publish Company Package` -> `Run workflow`.

Inputs:

- `version`: optional; leave empty to generate `10.8.1-webgl-text-animation.<timestamp>`
- `npm-tag`: npm dist-tag, usually `dev`
- `npm-access`: usually `restricted`

### Tag Publish

Create and push a tag like this:

```bash
git tag sgaz-openlayers/v10.8.1-webgl-text-animation.0
git push origin sgaz-openlayers/v10.8.1-webgl-text-animation.0
```

The workflow resolves the package version from the tag and publishes it with the `latest` dist-tag.

## npm Token

The workflow uses `NPM_TOKEN` from GitHub Actions secrets.

Repository path:

- `Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`

Secret name:

- `NPM_TOKEN`

Requirements for the token:

- it must belong to an npm user with publish rights for `@sgaz-pro/openlayers`
- prefer an automation token if the org uses 2FA
- use `restricted` access for private/internal publishes
- use `public` access only if the scoped package is intended to be public

## Local Verification

Build a company package locally:

```bash
OL_PACKAGE_NAME='@sgaz-pro/openlayers' \
OL_PACKAGE_VERSION='10.8.1-webgl-text-animation.0' \
OL_PACKAGE_REPOSITORY_URL='git+https://github.com/sgaz-pro/openlayers.git' \
OL_PACKAGE_HOMEPAGE='https://github.com/sgaz-pro/openlayers' \
OL_PACKAGE_BUGS_URL='https://github.com/sgaz-pro/openlayers/issues' \
npm run build-company-package
```

Check the generated package metadata:

```bash
sed -n '1,80p' build/ol/package.json
```

## Helper Script

Version helper: [`tasks/company-package-version.js`](../tasks/company-package-version.js)

Examples:

```bash
node tasks/company-package-version.js next
node tasks/company-package-version.js validate 10.8.1-webgl-text-animation.0
node tasks/company-package-version.js from-tag sgaz-openlayers/v10.8.1-webgl-text-animation.0
```

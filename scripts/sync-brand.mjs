#!/usr/bin/env node
// Mirror the workspace-linked @slidestage/brand/assets/ tree into this app's
// `public/brand/` directory so vite's `publicDir` machinery serves the same
// bytes in dev (`pnpm dev`) and copies them into `dist/brand/` on build.
//
// Lite app consumes `@slidestage/brand` via `workspace:*`, so the mirror
// source is literally `packages/brand/assets/` — but going through the
// `require.resolve('@slidestage/brand/package.json')` shape means the same
// script works after publish (in case someone installs Lite as an external
// app) and stays robust if the package later moves under `node_modules/`.
//
// `public/brand/` is in `.gitignore` because @slidestage/brand@npm is the
// single source of truth for those bytes.

import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);
const require = createRequire(import.meta.url);

const brandPkgJson = require.resolve('@slidestage/brand/package.json');
const brandAssetsRoot = join(dirname(brandPkgJson), 'assets');
const publicBrandDir = join(repoRoot, 'public', 'brand');

await rm(publicBrandDir, { recursive: true, force: true });
await mkdir(publicBrandDir, { recursive: true });
await cp(brandAssetsRoot, publicBrandDir, { recursive: true });

console.log(
  `[sync-brand] mirrored ${brandAssetsRoot} → ${publicBrandDir}`,
);

#!/usr/bin/env node
// Emit `dist/tokens.css` and `dist/tokens.json` from the canonical TS
// definitions in `src/tokens.ts`. We run this as a separate Node script
// (rather than letting tsup bundle it) because tsup is for the JS/DTS surface
// and these two text artifacts only need a tiny string render — keeping it
// out of tsup avoids forcing every other entry through unnecessary plugins.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);
const distDir = join(repoRoot, 'dist');

await mkdir(distDir, { recursive: true });

const tokensModuleUrl = pathToFileURL(join(distDir, 'tokens.js')).href;
const tokens = await import(tokensModuleUrl);

if (typeof tokens.renderTokensCss !== 'function' || typeof tokens.toCssVarMap !== 'function') {
  throw new Error(
    'build-tokens-css.mjs: dist/tokens.js must export renderTokensCss + toCssVarMap; did tsup run first?',
  );
}

const css = tokens.renderTokensCss();
const json = tokens.toCssVarMap();

const banner = `/* @slidestage/brand · auto-generated from src/tokens.ts.\n * Do not edit — change the TS source and re-run \`pnpm --filter @slidestage/brand build\`. */\n`;

await writeFile(join(distDir, 'tokens.css'), `${banner}\n${css}`, 'utf-8');
await writeFile(join(distDir, 'tokens.json'), `${JSON.stringify(json, null, 2)}\n`, 'utf-8');

// Verify by reading back so the build script fails fast if the disk write
// silently dropped content (defensive against future Windows / network FS
// edge cases that show up only in CI).
const cssBack = await readFile(join(distDir, 'tokens.css'), 'utf-8');
const jsonBack = await readFile(join(distDir, 'tokens.json'), 'utf-8');
if (!cssBack.includes('--ss-color-bg') || !jsonBack.includes('--ss-color-bg')) {
  throw new Error('build-tokens-css.mjs: emitted artifacts missing --ss-color-bg sentinel');
}

process.stdout.write(
  `[brand] wrote ${cssBack.length} bytes tokens.css + ${jsonBack.length} bytes tokens.json (${Object.keys(json).length} tokens)\n`,
);

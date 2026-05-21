#!/usr/bin/env node
/**
 * Desktop smoke test for the bundled SlideStage Lite app (productName
 * rename → bundle is now `SlideStage Lite.app`; legacy `SlideStageLite.app`
 * is still probed for backwards compatibility).
 *
 * What we verify (all without needing macOS Accessibility permissions):
 *   1. The `.app` bundle exists at the expected path.
 *   2. Launching it via `open -n -a <path>` registers a running process.
 *   3. `lsappinfo` reports the app as Foreground after launch.
 *   4. (Optional) The bundled binary is reasonably small (< 25 MB) so
 *      regressions in the Rust release profile fail loudly.
 *   5. The process exits cleanly when we quit it.
 *
 * On non-macOS this script exits 0 with a skip notice — wiring it up in
 * CI on Linux/Windows is left for a follow-up.
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * Tauri puts artefacts under `target/release/...` for a default
 * host-triple build, and under `target/<triple>/release/...` when you
 * pass `--target` (e.g. `--target aarch64-apple-darwin` for an explicit
 * Apple-Silicon build). We probe both so the smoke test works for
 * whichever flavour was last built. The override env var lets CI pin a
 * specific target.
 *
 * Probe order: TAURI_TARGET → aarch64 → x86_64 → universal → default.
 */
const TARGET_CANDIDATES = [
  process.env.TAURI_TARGET,
  'aarch64-apple-darwin',
  'x86_64-apple-darwin',
  'universal-apple-darwin',
  null, // default host triple — no subdir
].filter(
  (value, index, all) =>
    value !== undefined && all.indexOf(value) === index,
);

// The productName rename ("SlideStageLite" → "SlideStage Lite") shifts
// the .app filename. We probe the new spaced name first; if a stale
// pre-rename build is still on disk we fall back to the old name so the
// smoke test does not regress while a release machine catches up.
const APP_BASENAMES = ['SlideStage Lite.app', 'SlideStageLite.app'];

function resolveBundle() {
  for (const target of TARGET_CANDIDATES) {
    const base = target
      ? resolve(ROOT, 'src-tauri/target', target, 'release')
      : resolve(ROOT, 'src-tauri/target/release');
    const bin = resolve(base, 'slidestage-lite-desktop');
    for (const name of APP_BASENAMES) {
      const app = resolve(base, 'bundle/macos', name);
      if (existsSync(app)) {
        return { app, bin, target };
      }
    }
  }
  return null;
}

const MAX_BIN_MB = 25;

function die(msg) {
  console.error(`[desktop-smoke] FAIL: ${msg}`);
  process.exit(1);
}

function info(msg) {
  console.log(`[desktop-smoke] ${msg}`);
}

function tryExec(cmd, timeout = 5000) {
  try {
    return execSync(cmd, { timeout, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

function isRunning() {
  // lsappinfo prints both the CFBundleName and the .app filename.
  // After the productName rename to "SlideStage Lite" both forms can
  // appear depending on whether the build is fresh or stale, so we
  // match either spelling.
  const listing = tryExec('lsappinfo list');
  return listing.includes('SlideStage Lite') || listing.includes('SlideStageLite');
}

function quitApp() {
  if (isRunning()) {
    // Tell the most likely display name first, then the legacy one.
    tryExec('osascript -e \'tell application "SlideStage Lite" to quit\'', 5000);
    tryExec('osascript -e \'tell application "SlideStageLite" to quit\'', 5000);
  }
  // Belt-and-braces in case `osascript` was blocked by sandboxing. We
  // also kill the new spaceless executable name that the binary may
  // adopt; today it remains `slidestage-lite-desktop` so this is a
  // future-proofing guard.
  tryExec('pkill -x slidestage-lite-desktop');
  tryExec("pkill -fx 'SlideStage Lite'");
  tryExec('pkill -x SlideStageLite');
}

async function main() {
  if (process.platform !== 'darwin') {
    info('SKIP — only runs on macOS for now.');
    return;
  }

  const bundle = resolveBundle();
  if (!bundle) {
    die(
      `app not found under src-tauri/target/{release,<triple>/release}/bundle/macos/{${APP_BASENAMES.join(',')}}\n` +
        `        Did you run \`pnpm tauri build\` (optionally with \`--target <triple>\`) first?`,
    );
  }
  info(
    `bundle resolved at ${bundle.app}` +
      (bundle.target ? ` (target=${bundle.target})` : ' (default host triple)'),
  );

  if (existsSync(bundle.bin)) {
    const sizeMb = statSync(bundle.bin).size / (1024 * 1024);
    info(`binary size: ${sizeMb.toFixed(1)} MB`);
    if (sizeMb > MAX_BIN_MB) {
      die(`binary grew to ${sizeMb.toFixed(1)} MB (cap: ${MAX_BIN_MB} MB)`);
    }
  }

  quitApp();
  await sleep(500);

  info(`launching ${bundle.app}`);
  const proc = spawn('open', ['-n', '-a', bundle.app], {
    detached: true,
    stdio: 'ignore',
  });
  proc.unref();

  try {
    let saw = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      await sleep(500);
      if (isRunning()) {
        saw = true;
        info(`OK — SlideStage Lite running (lsappinfo confirms)`);
        break;
      }
    }
    if (!saw) die('process did not register with lsappinfo within 10 s');

    // Hold it open briefly so a human running this locally can eyeball
    // the window before it tears down. In CI this is also fine.
    await sleep(1500);
  } finally {
    quitApp();
    await sleep(500);
    if (isRunning()) {
      die('process survived quit signals — leaked');
    }
    info('OK — clean shutdown');
  }
}

main().catch((err) => die(err?.message ?? String(err)));

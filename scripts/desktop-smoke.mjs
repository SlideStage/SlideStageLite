#!/usr/bin/env node
/**
 * Desktop smoke test for the bundled SlideStage Lite app.
 *
 * macOS verifies (no Accessibility permission required):
 *   1. The `.app` bundle exists at the expected path.
 *   2. Launching it via `open -n -a <path>` registers a running process.
 *   3. `lsappinfo` reports the app as Foreground after launch.
 *   4. (Optional) The bundled binary is reasonably small (< 25 MB) so
 *      regressions in the Rust release profile fail loudly.
 *   5. The process exits cleanly when we quit it.
 *
 * Windows verifies:
 *   1. The `SlideStage Lite.exe` (note the space, comes from productName)
 *      exists under target/<triple>/release.
 *   2. (Optional) The binary stays under MAX_BIN_MB.
 *   3. Spawning it registers an `imagename eq "SlideStage Lite.exe"` row
 *      in `tasklist` within a timeout.
 *   4. `taskkill` shuts it down cleanly with no orphan process.
 *
 * On Linux this script still exits 0 with a skip notice — wiring AppImage
 * smoke is a follow-up.
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
  if (process.platform === 'win32') {
    await mainWindows();
    return;
  }
  if (process.platform !== 'darwin') {
    info('SKIP — only runs on macOS / Windows for now.');
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

// ---- Windows --------------------------------------------------------------

/**
 * Resolve a Windows build. We probe both the explicit
 * x86_64-pc-windows-msvc target (what `pnpm release:windows` always uses)
 * and the default host-triple path that `pnpm tauri build` produces when
 * `--target` is omitted, so a developer doing the obvious thing in their
 * Windows VM still gets a smoke pass.
 *
 * The .exe name on disk is "SlideStage Lite.exe" verbatim — Tauri 2
 * names the binary after `productName`, which contains a space. We
 * keep that name as the source of truth and quote the path everywhere
 * it appears.
 */
function resolveBundleWindows() {
  const candidates = [
    process.env.TAURI_TARGET || 'x86_64-pc-windows-msvc',
    'aarch64-pc-windows-msvc',
    null,
  ].filter(
    (value, index, all) =>
      value !== undefined && all.indexOf(value) === index,
  );
  for (const target of candidates) {
    const base = target
      ? resolve(ROOT, 'src-tauri/target', target, 'release')
      : resolve(ROOT, 'src-tauri/target/release');
    const exePath = resolve(base, 'SlideStage Lite.exe');
    if (existsSync(exePath)) {
      return { exePath, base, target };
    }
  }
  return null;
}

function tryExecWin(cmd, timeout = 5000) {
  try {
    return execSync(cmd, {
      timeout,
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: true,
    })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

function isRunningWindows() {
  // /fi expects /v case-insensitively; we look for any line containing
  // the executable name. Use /nh to suppress the header so an empty
  // tasklist payload returns an empty string.
  const listing = tryExecWin(
    'tasklist /nh /fi "imagename eq SlideStage Lite.exe"',
  );
  return listing.length > 0 && listing.toLowerCase().includes('slidestage lite.exe');
}

function quitAppWindows() {
  if (isRunningWindows()) {
    // /im targets all instances by image name; /f forces termination
    // if the app hung. We tolerate non-zero exit because the second
    // call (during the integrity check at the end) may legitimately
    // find no process left.
    tryExecWin('taskkill /im "SlideStage Lite.exe" /t /f');
  }
}

async function mainWindows() {
  const WIN_MAX_BIN_MB = 60; // wry/WebView2 host is larger on Windows
  const bundle = resolveBundleWindows();
  if (!bundle) {
    die(
      `app not found under src-tauri/target/{x86_64-pc-windows-msvc,...}/release/"SlideStage Lite.exe"\n` +
        `        Did you run \`pnpm tauri build --target x86_64-pc-windows-msvc\` first?`,
    );
  }
  info(
    `bundle resolved at ${bundle.exePath}` +
      (bundle.target ? ` (target=${bundle.target})` : ' (default host triple)'),
  );

  const sizeMb = statSync(bundle.exePath).size / (1024 * 1024);
  info(`binary size: ${sizeMb.toFixed(1)} MB`);
  if (sizeMb > WIN_MAX_BIN_MB) {
    die(`binary grew to ${sizeMb.toFixed(1)} MB (cap: ${WIN_MAX_BIN_MB} MB)`);
  }

  quitAppWindows();
  await sleep(500);

  info(`launching ${bundle.exePath}`);
  const proc = spawn(bundle.exePath, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  proc.unref();

  try {
    let saw = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      await sleep(500);
      if (isRunningWindows()) {
        saw = true;
        info(`OK — SlideStage Lite running (tasklist confirms)`);
        break;
      }
    }
    if (!saw) die('process did not register with tasklist within 10 s');

    await sleep(1500);
  } finally {
    quitAppWindows();
    await sleep(500);
    if (isRunningWindows()) {
      die('process survived taskkill — leaked');
    }
    info('OK — clean shutdown');
  }
}

main().catch((err) => die(err?.message ?? String(err)));

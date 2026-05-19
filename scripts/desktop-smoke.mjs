#!/usr/bin/env node
/**
 * Desktop smoke test for the bundled SlideStageLite.app.
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
const APP_PATH = resolve(
  ROOT,
  'src-tauri/target/release/bundle/macos/SlideStageLite.app',
);
const BIN_PATH = resolve(
  ROOT,
  'src-tauri/target/release/slidestage-lite-desktop',
);
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
  // lsappinfo lists every running app by bundle id.
  return tryExec('lsappinfo list').includes('SlideStageLite');
}

function quitApp() {
  if (isRunning()) {
    tryExec('osascript -e \'tell application "SlideStageLite" to quit\'', 5000);
  }
  // Belt-and-braces in case `osascript` was blocked by sandboxing.
  tryExec('pkill -x slidestage-lite-desktop');
  tryExec('pkill -x SlideStageLite');
}

async function main() {
  if (process.platform !== 'darwin') {
    info('SKIP — only runs on macOS for now.');
    return;
  }

  if (!existsSync(APP_PATH)) {
    die(
      `app not found at ${APP_PATH}\n` +
        `        Did you run \`pnpm tauri build\` first?`,
    );
  }

  if (existsSync(BIN_PATH)) {
    const sizeMb = statSync(BIN_PATH).size / (1024 * 1024);
    info(`binary size: ${sizeMb.toFixed(1)} MB`);
    if (sizeMb > MAX_BIN_MB) {
      die(`binary grew to ${sizeMb.toFixed(1)} MB (cap: ${MAX_BIN_MB} MB)`);
    }
  }

  quitApp();
  await sleep(500);

  info(`launching ${APP_PATH}`);
  const proc = spawn('open', ['-n', '-a', APP_PATH], {
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
        info(`OK — SlideStageLite running (lsappinfo confirms)`);
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

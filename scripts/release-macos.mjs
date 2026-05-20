#!/usr/bin/env node
/**
 * SlideStageLite — macOS release orchestrator.
 *
 * Pipeline (per the agreed plan: 1B + 2B + 3C + 4A):
 *
 *   1. Load .env.local so APPLE_* vars become available to Tauri's
 *      bundler (Tauri picks them up automatically from process.env).
 *   2. Detect mode:
 *        - dry-run            → validate config + env, exit.
 *        - skip-notarize      → adhoc sign only, useful when the user
 *                               has no Developer ID cert yet.
 *        - full (default)     → sign + notarize + staple via Tauri,
 *                               then run all post-build verifications.
 *   3. Invoke `pnpm tauri build --target aarch64-apple-darwin`.
 *   4. Verify .app codesign, dmg signature, dmg stapling, Gatekeeper
 *      acceptance (`spctl --assess --type install`).
 *   5. Rename artifacts to the dist-desktop naming scheme and copy
 *      them next to the existing platform binaries.
 *   6. Rewrite dist-desktop/SHA256SUMS.txt deterministically.
 *
 * The script is intentionally chatty: every transition prints a marker
 * so a CI log or `tail -f` reader can see where we are.
 *
 * Required env vars for the default "full" mode (load via .env.local):
 *
 *   APPLE_SIGNING_IDENTITY     e.g. "Developer ID Application: Foo Bar (TEAMID)"
 *   APPLE_API_KEY              ASC API Key ID (10 chars)
 *   APPLE_API_ISSUER           ASC API Issuer ID (UUID)
 *   APPLE_API_KEY_PATH         absolute path to AuthKey_<KEYID>.p8
 *
 * Optional:
 *
 *   APPLE_TEAM_ID              only needed when signing identity is ambiguous
 *   TAURI_BUNDLE_ARGS          extra args appended after `pnpm tauri build`
 *
 * Usage:
 *
 *   pnpm release:macos
 *   pnpm release:macos --dry-run
 *   pnpm release:macos --skip-notarize          # adhoc-only build (no Apple creds)
 *   pnpm release:macos --skip-stapling          # initial notarization pass only
 */

import { execSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const TARGET = 'aarch64-apple-darwin';
const TARGET_BUNDLE = resolve(
  ROOT,
  'src-tauri/target',
  TARGET,
  'release/bundle',
);
const DIST_DESKTOP = resolve(ROOT, 'dist-desktop');
const TAURI_CONF = resolve(ROOT, 'src-tauri/tauri.conf.json');
const ENV_LOCAL = resolve(ROOT, '.env.local');
const SHA256SUMS = resolve(DIST_DESKTOP, 'SHA256SUMS.txt');

// ---- Args ----------------------------------------------------------------

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has('--dry-run');
const SKIP_NOTARIZE = ARGS.has('--skip-notarize');
const SKIP_STAPLING = ARGS.has('--skip-stapling');
const VERBOSE = ARGS.has('--verbose') || !!process.env.CI;

// ---- Logging ------------------------------------------------------------

function step(msg) {
  console.log(`\n[release-macos] ▶ ${msg}`);
}

function info(msg) {
  console.log(`[release-macos]   ${msg}`);
}

function warn(msg) {
  console.warn(`[release-macos] ⚠  ${msg}`);
}

function die(msg) {
  console.error(`\n[release-macos] ✖ ${msg}\n`);
  process.exit(1);
}

// ---- .env.local loader (no dotenv dep) ----------------------------------

function loadDotenv(path) {
  if (!existsSync(path)) return {};
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const out = {};
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// ---- Bootstrap ----------------------------------------------------------

if (process.platform !== 'darwin') {
  die(
    'macOS release pipeline only runs on darwin. Use CI on macos-latest for cross-platform release.',
  );
}

const dotenv = loadDotenv(ENV_LOCAL);
for (const [key, value] of Object.entries(dotenv)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const versionFromConf = (() => {
  try {
    return JSON.parse(readFileSync(TAURI_CONF, 'utf8')).version ?? '0.0.0';
  } catch (err) {
    die(`failed to read ${TAURI_CONF}: ${err.message}`);
  }
})();
info(`product version: ${versionFromConf}`);

// ---- Mode resolution ----------------------------------------------------

let mode;
if (DRY_RUN) {
  mode = 'dry-run';
} else if (SKIP_NOTARIZE) {
  mode = 'skip-notarize';
} else {
  mode = 'full';
}
info(`mode: ${mode}${SKIP_STAPLING ? ' (skip-stapling)' : ''}`);

// ---- Env validation -----------------------------------------------------

function checkEnv(name) {
  const present = !!process.env[name] && process.env[name].length > 0;
  info(`  ${present ? '✓' : '✗'} ${name}${present ? '' : '  (missing)'}`);
  return present;
}

step('Validating environment');

const hasIdentity = checkEnv('APPLE_SIGNING_IDENTITY');
const hasApiKey = checkEnv('APPLE_API_KEY');
const hasApiIssuer = checkEnv('APPLE_API_ISSUER');
const hasApiKeyPath = checkEnv('APPLE_API_KEY_PATH');
const hasTeamId = checkEnv('APPLE_TEAM_ID');

if (hasApiKeyPath && !existsSync(process.env.APPLE_API_KEY_PATH)) {
  die(
    `APPLE_API_KEY_PATH points to ${process.env.APPLE_API_KEY_PATH}, but no file exists there.`,
  );
}

if (mode === 'full') {
  const missing = [];
  if (!hasIdentity) missing.push('APPLE_SIGNING_IDENTITY');
  if (!hasApiKey) missing.push('APPLE_API_KEY');
  if (!hasApiIssuer) missing.push('APPLE_API_ISSUER');
  if (!hasApiKeyPath) missing.push('APPLE_API_KEY_PATH');
  if (missing.length) {
    die(
      `Cannot run full notarization pipeline. Missing required env vars:\n` +
        missing.map((m) => `    - ${m}`).join('\n') +
        `\n\n  Either:\n` +
        `    a) put them in .env.local (see .env.example), or\n` +
        `    b) re-run with --skip-notarize for an adhoc-only build, or\n` +
        `    c) re-run with --dry-run to validate config without building.`,
    );
  }
}

if (mode === 'skip-notarize') {
  if (hasIdentity && process.env.APPLE_SIGNING_IDENTITY !== '-') {
    warn(
      `--skip-notarize was passed but APPLE_SIGNING_IDENTITY is set to a real identity (${process.env.APPLE_SIGNING_IDENTITY}). Forcing adhoc to keep this run reproducible.`,
    );
  }
  process.env.APPLE_SIGNING_IDENTITY = '-';
  delete process.env.APPLE_API_KEY;
  delete process.env.APPLE_API_ISSUER;
  delete process.env.APPLE_API_KEY_PATH;
}

if (mode === 'full' && hasIdentity) {
  step('Verifying signing identity is installed in keychain');
  const ident = process.env.APPLE_SIGNING_IDENTITY;
  const haystack = tryExec('security find-identity -v -p codesigning');
  if (!haystack.includes(ident)) {
    die(
      `Signing identity "${ident}" not found in keychain. Run \`security find-identity -v -p codesigning\` to see what's available.`,
    );
  }
  info('signing identity present');
}

if (mode === 'dry-run') {
  step('Dry run complete — no build performed');
  info(`Would invoke: pnpm tauri build --target ${TARGET}`);
  info(`Would write artifacts to: ${DIST_DESKTOP}`);
  process.exit(0);
}

// ---- Build --------------------------------------------------------------

step(`Building Tauri bundle (--target ${TARGET})`);

const extraArgs = (process.env.TAURI_BUNDLE_ARGS ?? '')
  .split(/\s+/)
  .filter(Boolean);
const buildArgs = ['tauri', 'build', '--target', TARGET, ...extraArgs];
if (SKIP_STAPLING) buildArgs.push('--', '--skip-stapling');

const build = spawnSync('pnpm', buildArgs, {
  stdio: 'inherit',
  cwd: ROOT,
  env: process.env,
});
if (build.status !== 0) {
  die(`tauri build failed with exit code ${build.status}`);
}

// ---- Locate artifacts ---------------------------------------------------

step('Resolving build artifacts');

const APP = resolve(TARGET_BUNDLE, 'macos/SlideStageLite.app');
if (!existsSync(APP)) {
  die(`expected .app missing at ${APP}`);
}
info(`app: ${APP}`);

const dmgDir = resolve(TARGET_BUNDLE, 'dmg');
const dmgEntries = readdirSync(dmgDir).filter((f) => f.endsWith('.dmg'));
if (dmgEntries.length === 0) {
  die(`no .dmg found in ${dmgDir}`);
}
const DMG_ORIG = resolve(dmgDir, dmgEntries[0]);
info(`dmg: ${DMG_ORIG}`);

// ---- Verification -------------------------------------------------------

step('Verifying signature on .app');
runOrDie(`codesign --verify --deep --strict --verbose=2 "${APP}"`, {
  hint: 'codesign verify failed — bundle is unsigned or broken',
});
const appSig = tryExec(`codesign -dv --verbose=4 "${APP}" 2>&1`);
if (VERBOSE) console.log(appSig);
const isAdhocApp = /Signature=adhoc/i.test(appSig);
if (mode === 'full' && isAdhocApp) {
  die(
    'app is adhoc-signed but mode=full requires a Developer ID identity. ' +
      'Check that APPLE_SIGNING_IDENTITY was set when Tauri ran codesign.',
  );
}
info(isAdhocApp ? 'app signed (adhoc)' : 'app signed (Developer ID)');

if (mode === 'full') {
  step('Verifying notarization staple on .app');
  const stapleResult = spawnSync('xcrun', ['stapler', 'validate', APP], {
    stdio: VERBOSE ? 'inherit' : 'pipe',
  });
  if (stapleResult.status !== 0) {
    if (SKIP_STAPLING) {
      warn(
        'stapler validate failed but --skip-stapling was requested, so this is expected. Remember to staple before shipping.',
      );
    } else {
      die(
        'stapler validate FAILED on .app — notarization either errored or was not stapled. ' +
          'Check `xcrun notarytool history --key ... --key-id ... --issuer ...` for details.',
      );
    }
  } else {
    info('app stapled OK');
  }

  step('Asking Gatekeeper to assess the .app');
  const spctl = spawnSync(
    'spctl',
    ['--assess', '--type', 'execute', '--verbose=4', APP],
    { stdio: VERBOSE ? 'inherit' : 'pipe' },
  );
  if (spctl.status !== 0) {
    warn(
      'spctl rejected the .app. On a clean machine this would show as "macOS cannot verify". Investigate before shipping.',
    );
  } else {
    info('spctl accepted .app');
  }
}

step('Verifying signature on .dmg');
runOrDie(`codesign --verify --verbose=2 "${DMG_ORIG}"`, {
  hint:
    'dmg signature missing. Tauri only signs the dmg when APPLE_SIGNING_IDENTITY is a real Developer ID.',
  softFailWhen: mode !== 'full',
});

if (mode === 'full') {
  step('Verifying staple on .dmg');
  const stapleDmg = spawnSync('xcrun', ['stapler', 'validate', DMG_ORIG], {
    stdio: VERBOSE ? 'inherit' : 'pipe',
  });
  if (stapleDmg.status !== 0 && !SKIP_STAPLING) {
    die(
      'dmg is not stapled. Notarization may not have completed for the dmg surface.',
    );
  } else if (stapleDmg.status === 0) {
    info('dmg stapled OK');
  }
}

// ---- Publish to dist-desktop -------------------------------------------

step('Publishing to dist-desktop/');

if (!existsSync(DIST_DESKTOP)) mkdirSync(DIST_DESKTOP, { recursive: true });

const FINAL_NAME = `SlideStageLite-${versionFromConf}-macOS-AppleSilicon.dmg`;
const FINAL_PATH = resolve(DIST_DESKTOP, FINAL_NAME);
copyFileSync(DMG_ORIG, FINAL_PATH);
info(`copied: ${FINAL_NAME}`);

// ---- Refresh SHA256SUMS.txt --------------------------------------------

step('Refreshing dist-desktop/SHA256SUMS.txt');

const dmgEntriesAll = readdirSync(DIST_DESKTOP)
  .filter((f) => /\.(dmg|exe)$/i.test(f))
  .sort();

const lines = [];
for (const file of dmgEntriesAll) {
  const hash = await sha256(resolve(DIST_DESKTOP, file));
  lines.push(`${hash}  ${file}`);
}
writeFileSync(SHA256SUMS, lines.join('\n') + '\n', 'utf8');
info(`rewrote ${SHA256SUMS} (${lines.length} entries)`);

step('Done');
info(`Final artifact: ${FINAL_PATH}`);
info(`Mode: ${mode}${SKIP_STAPLING ? ' (skip-stapling)' : ''}`);
if (mode === 'skip-notarize') {
  warn(
    'This build is adhoc-signed and NOT notarized. Do not ship it to end users.',
  );
}

// ---- Helpers ------------------------------------------------------------

function tryExec(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] })
      .toString()
      .trim();
  } catch (err) {
    return (err.stdout?.toString?.() ?? '') + (err.stderr?.toString?.() ?? '');
  }
}

function runOrDie(cmd, { hint, softFailWhen = false } = {}) {
  try {
    execSync(cmd, { stdio: VERBOSE ? 'inherit' : 'pipe' });
  } catch (err) {
    const stderr = err.stderr?.toString?.() ?? '';
    if (softFailWhen) {
      warn(`${hint}\n  command: ${cmd}\n  stderr: ${stderr.trim()}`);
      return;
    }
    die(`${hint}\n  command: ${cmd}\n  stderr: ${stderr.trim()}`);
  }
}

async function sha256(filePath) {
  return await new Promise((resolveP, rejectP) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveP(hash.digest('hex')));
    stream.on('error', rejectP);
  });
}

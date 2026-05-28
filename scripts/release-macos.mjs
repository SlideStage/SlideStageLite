#!/usr/bin/env node
/**
 * SlideStage Lite — macOS release orchestrator.
 *
 * Pipeline (per the agreed plan: 1B + 2B + 3C + 4A, plus auto-updater
 * hand-off):
 *
 *   1. Load .env.local so APPLE_* and TAURI_SIGNING_* vars become
 *      available to Tauri's bundler (Tauri picks them up automatically
 *      from process.env).
 *   2. Detect mode:
 *        - dry-run            → validate config + env, exit.
 *        - skip-notarize      → adhoc sign only, useful when the user
 *                               has no Developer ID cert yet.
 *        - full (default)     → sign + notarize + staple via Tauri,
 *                               then run all post-build verifications.
 *   3. Invoke `pnpm tauri build --target aarch64-apple-darwin`. With
 *      `bundle.createUpdaterArtifacts=true` and `TAURI_SIGNING_*`
 *      present, this also emits `<app>.app.tar.gz` + `.sig`.
 *   4. Verify .app codesign, dmg signature, dmg stapling, Gatekeeper
 *      acceptance (`spctl --assess --type install`).
 *   5. Rename artifacts to the dist-desktop naming scheme and copy
 *      them next to the existing platform binaries.
 *   6. Build the static `latest.json` updater manifest (delegates to
 *      `scripts/build-update-manifest.mjs`) so the Tauri client can
 *      discover the new release.
 *   7. Rewrite dist-desktop/SHA256SUMS.txt deterministically.
 *   8. Optional: `--upload` attaches every dist-desktop artifact to the
 *      matching GitHub Release via `gh release upload`. Requires `gh`
 *      to be authenticated and the `v<version>` tag to already exist.
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
 * Auto-updater env vars (skipped when --skip-updater is passed):
 *
 *   TAURI_SIGNING_PRIVATE_KEY           path to / contents of the minisign key
 *   TAURI_SIGNING_PRIVATE_KEY_PASSWORD  password used to encrypt the key
 *
 * Optional:
 *
 *   APPLE_TEAM_ID              only needed when signing identity is ambiguous
 *   TAURI_BUNDLE_ARGS          extra args appended after `pnpm tauri build`
 *   RELEASE_TARGET             Rust triple to build, defaults to
 *                              aarch64-apple-darwin. Use
 *                              x86_64-apple-darwin to ship for Intel Macs.
 *   UPDATER_ASSET_BASE_URL     override the GitHub Releases base URL
 *                              embedded into latest.json (useful when
 *                              mirroring to Cloudflare R2 etc.)
 *
 * Usage:
 *
 *   pnpm release:macos
 *   pnpm release:macos --dry-run
 *   pnpm release:macos --skip-notarize          # adhoc-only build (no Apple creds)
 *   pnpm release:macos --skip-stapling          # initial notarization pass only
 *   pnpm release:macos --skip-updater           # legacy build, no .app.tar.gz / latest.json
 *   pnpm release:macos --upload                 # upload artifacts to gh release v<version>
 *   RELEASE_TARGET=x86_64-apple-darwin pnpm release:macos   # Intel build
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
const TARGET = process.env.RELEASE_TARGET || 'aarch64-apple-darwin';
// Map Rust triple to the human-friendly suffix used in dist-desktop file
// names. Anything unrecognised falls back to the triple itself so we never
// silently lose architecture info.
const TARGET_NAME_SUFFIX = {
  'aarch64-apple-darwin': 'AppleSilicon',
  'x86_64-apple-darwin': 'Intel',
  'universal-apple-darwin': 'universal',
}[TARGET] || TARGET;
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
const SKIP_UPDATER = ARGS.has('--skip-updater');
const UPLOAD = ARGS.has('--upload');
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
const hasUpdaterKey = checkEnv('TAURI_SIGNING_PRIVATE_KEY');
const hasUpdaterKeyPassword = checkEnv('TAURI_SIGNING_PRIVATE_KEY_PASSWORD');

if (hasApiKeyPath && !existsSync(process.env.APPLE_API_KEY_PATH)) {
  die(
    `APPLE_API_KEY_PATH points to ${process.env.APPLE_API_KEY_PATH}, but no file exists there.`,
  );
}

// TAURI_SIGNING_PRIVATE_KEY accepts either a file path (local dev) or
// the raw key contents (CI). The keyfile that `tauri signer generate`
// emits is a base64-encoded blob whose plaintext starts with
// "untrusted comment:", so the base64 form starts with the magic
// "dW50cnVzdGVkIGNvbW1lbnQ6…". Recognize either signature as "this is
// key contents, not a path" before falling through to the path check.
const macUpdaterKeyValue = process.env.TAURI_SIGNING_PRIVATE_KEY ?? '';
const macLooksLikeKeyContent =
  macUpdaterKeyValue.includes('untrusted comment') ||
  macUpdaterKeyValue.startsWith('dW50cnVzdGVkIGNvbW1lbnQ6');
if (
  !SKIP_UPDATER &&
  hasUpdaterKey &&
  !macLooksLikeKeyContent &&
  !existsSync(macUpdaterKeyValue)
) {
  die(
    `TAURI_SIGNING_PRIVATE_KEY="${macUpdaterKeyValue.slice(0, 40)}…" looks like a path but no file exists there. Run \`pnpm updater:keygen\` first.`,
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

// Updater signing creds: required unless --skip-updater. Missing key →
// `pnpm tauri build` quietly produces an unsigned `.app.tar.gz` that
// every client will reject; far better to fail fast here.
if (!SKIP_UPDATER && mode !== 'dry-run') {
  if (!hasUpdaterKey) {
    die(
      'TAURI_SIGNING_PRIVATE_KEY is missing. Either:\n' +
        '    a) put it in .env.local (see .env.example), then re-run, or\n' +
        '    b) re-run with --skip-updater to ship without an auto-updater artifact.\n' +
        '\n  Run `pnpm updater:keygen` once if you have not generated a keypair yet.',
    );
  }
  if (!hasUpdaterKeyPassword) {
    warn(
      'TAURI_SIGNING_PRIVATE_KEY_PASSWORD is empty. That works only if the keypair was generated without a password (NOT recommended).',
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
  info(
    `Updater step: ${SKIP_UPDATER ? 'SKIPPED (--skip-updater)' : 'would run scripts/build-update-manifest.mjs'}`,
  );
  info(`Upload step: ${UPLOAD ? 'would run gh release upload' : 'skipped (pass --upload to enable)'}`);
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

// Tauri 2 uses `productName` verbatim for the .app filename. After we
// renamed productName from "SlideStageLite" to "SlideStage Lite" the
// new builds land under `macos/SlideStage Lite.app`. We keep the old
// path as a fallback so a release machine that still has the
// pre-rename bundle from a previous build does not silently fail.
const APP_CANDIDATES = [
  resolve(TARGET_BUNDLE, 'macos/SlideStage Lite.app'),
  resolve(TARGET_BUNDLE, 'macos/SlideStageLite.app'),
];
const APP = APP_CANDIDATES.find((p) => existsSync(p));
if (!APP) {
  die(
    `expected .app missing at any of:\n` +
      APP_CANDIDATES.map((p) => `    - ${p}`).join('\n'),
  );
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

// Tauri's bundler submits + staples the inner .app, but does NOT submit
// the outer .dmg to Apple. Without a separate submission the dmg has no
// ticket, `stapler staple` would fail, and Gatekeeper shows "macOS
// cannot verify" on first open. We therefore notarize the dmg here.
if (mode === 'full' && !SKIP_STAPLING) {
  step('Ensuring .dmg has a notarization staple');
  if (dmgIsStapled(DMG_ORIG)) {
    info('dmg already stapled — skipping re-notarization');
  } else {
    info(
      'dmg is not yet stapled — submitting to Apple notary service ' +
        '(this usually takes 1–3 minutes; progress prints below)',
    );
    const submission = notarizeDmg(DMG_ORIG);
    info(`submission id: ${submission.id}`);
    info(`submission status: ${submission.status}`);
    if (submission.status !== 'Accepted') {
      die(
        `notarytool returned status="${submission.status}" for ${submission.id}.\n` +
          `  Inspect the log with:\n` +
          `    xcrun notarytool log ${submission.id} \\\n` +
          `      --key "${process.env.APPLE_API_KEY_PATH}" \\\n` +
          `      --key-id "${process.env.APPLE_API_KEY}" \\\n` +
          `      --issuer "${process.env.APPLE_API_ISSUER}"`,
      );
    }
    runOrDie(`xcrun stapler staple "${DMG_ORIG}"`, {
      hint: 'stapler staple failed on the .dmg after notarization',
    });
    info('dmg stapled');
  }
}

if (mode === 'full') {
  step('Verifying staple on .dmg');
  const stapleDmg = spawnSync('xcrun', ['stapler', 'validate', DMG_ORIG], {
    stdio: VERBOSE ? 'inherit' : 'pipe',
  });
  if (stapleDmg.status !== 0 && !SKIP_STAPLING) {
    die(
      'dmg is not stapled even after submission. Run `xcrun notarytool history ...` ' +
        'and inspect the latest submission log.',
    );
  } else if (stapleDmg.status === 0) {
    info('dmg stapled OK');
  }
}

// ---- Publish to dist-desktop -------------------------------------------

step('Publishing to dist-desktop/');

if (!existsSync(DIST_DESKTOP)) mkdirSync(DIST_DESKTOP, { recursive: true });

const FINAL_NAME = `SlideStageLite-${versionFromConf}-macOS-${TARGET_NAME_SUFFIX}.dmg`;
const FINAL_PATH = resolve(DIST_DESKTOP, FINAL_NAME);
copyFileSync(DMG_ORIG, FINAL_PATH);
info(`copied: ${FINAL_NAME}`);

// ---- Fetch existing latest.json from GitHub release (for cross-platform merge) ----
//
// Symmetric to the prefetch already implemented in release-windows.mjs.
// When the Windows pipeline (GHA) and the macOS pipeline (local) ship the
// same version, whichever runs LAST must merge into the other's already-
// uploaded manifest, otherwise its `gh release upload --clobber` will
// silently overwrite the first runner's platform block with a manifest
// that only knows about its own platform. By pulling the live manifest
// from the GitHub Release before running build-update-manifest, we let
// `--merge-existing` see (and preserve) the other runner's blocks.
//
// Also covers the Intel-mac-after-AppleSilicon case on a single local
// machine where dist-desktop/latest.json may have been deleted between
// runs (e.g. after a CI clean) — the manifest gets repopulated from the
// release before merging the new darwin-x86_64 block in.
//
// Permissive on failure: a missing release / missing asset is normal on
// a first publish (no other-platform block exists yet to preserve). Only
// network/auth errors are surfaced as warnings; nothing is fatal.

if (!SKIP_UPDATER) {
  step('Fetching existing latest.json from GitHub release (cross-platform merge prep)');
  fetchExistingLatestJson(versionFromConf);
}

// ---- Build updater manifest (latest.json) ------------------------------

if (!SKIP_UPDATER) {
  step('Building updater manifest (latest.json) + publishing .app.tar.gz');
  const manifestResult = spawnSync(
    'node',
    [
      resolve(ROOT, 'scripts/build-update-manifest.mjs'),
      '--target',
      TARGET,
      // Merge with any platform block already in dist-desktop/latest.json.
      // Without this, a follow-up `pnpm release:macos` for the *other*
      // mac arch (Intel after AppleSilicon, or vice versa) would silently
      // overwrite the first block — manifest would only carry the most
      // recent arch and the other half of mac users would stall on the
      // previous release. The flag is a no-op when latest.json doesn't
      // yet exist (first build of the version), so it's safe to leave on.
      '--merge-existing',
    ],
    {
      stdio: 'inherit',
      cwd: ROOT,
      env: process.env,
    },
  );
  if (manifestResult.status !== 0) {
    die(
      'build-update-manifest.mjs exited non-zero. The DMG is still valid but the auto-updater will not pick this release up.',
    );
  }
} else {
  warn('Skipping updater manifest (--skip-updater was passed).');
}

// ---- Refresh SHA256SUMS.txt --------------------------------------------

// build-update-manifest.mjs already refreshes SHA256SUMS.txt with the
// updater archives included. Re-run the original DMG-only refresh only
// when the updater step was skipped, otherwise we'd lose the .app.tar.gz
// entries the manifest step just wrote.
if (SKIP_UPDATER) {
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
}

// ---- Optional: upload to GitHub Release --------------------------------

if (UPLOAD) {
  step(`Uploading artifacts to GitHub release v${versionFromConf}`);
  uploadToGithubRelease(versionFromConf);
} else {
  info('Skipping GitHub upload (pass --upload to enable).');
}

step('Done');
info(`Final artifact: ${FINAL_PATH}`);
info(`Mode: ${mode}${SKIP_STAPLING ? ' (skip-stapling)' : ''}`);
if (!SKIP_UPDATER) {
  info('Updater manifest: dist-desktop/latest.json');
}
if (mode === 'skip-notarize') {
  warn(
    'This build is adhoc-signed and NOT notarized. Do not ship it to end users.',
  );
}

// ---- Helpers ------------------------------------------------------------

/**
 * Upload every dist-desktop artifact that matches the running version
 * to the matching GitHub Release tag (v<version>). Uses `gh release
 * upload --clobber` so a re-run replaces the existing assets without
 * failing.
 *
 * Requires the user to have `gh` authenticated AND the tag to exist
 * (this script does NOT create the release — that's a manual `gh
 * release create v<version>` step we want to keep human-gated).
 */
function uploadToGithubRelease(version) {
  const tag = `v${version}`;
  // Sanity: does gh exist?
  const ghCheck = spawnSync('gh', ['--version'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (ghCheck.status !== 0) {
    die(
      'gh CLI is required for --upload but `gh --version` failed. Install with `brew install gh` and run `gh auth login`.',
    );
  }
  // Sanity: does the release exist?
  const exists = spawnSync('gh', ['release', 'view', tag], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (exists.status !== 0) {
    die(
      `GitHub release ${tag} does not exist yet. Create it first with:\n` +
        `    gh release create ${tag} --title "${tag}" --notes-from-tag\n` +
        `Then re-run with --upload.`,
    );
  }
  // Collect everything we want to ship. Updater archives + .sig +
  // latest.json + DMGs + (eventually) Windows/Linux installers.
  //
  // We pin the SlideStageLite-* match to the build's exact version
  // string so stale artifacts from a previous release (which legitimately
  // accumulate in dist-desktop/ across `pnpm release:macos` runs) don't
  // silently piggy-back onto the new GitHub Release. latest.json /
  // SHA256SUMS.txt are inherently single-version anchors, so they stay
  // un-pinned.
  const versionPin = version.replace(/[.+]/g, '\\$&');
  const uploadPattern = new RegExp(
    `^(latest\\.json|SHA256SUMS\\.txt|SlideStageLite-${versionPin}-.+\\.(dmg|exe|msi|app\\.tar\\.gz|app\\.tar\\.gz\\.sig))$`,
  );
  const all = readdirSync(DIST_DESKTOP)
    .filter((f) => uploadPattern.test(f))
    .filter((f) => !f.includes(' ')) // Defensive: HTTP-mangled spaces.
    .sort();
  if (all.length === 0) {
    die('Nothing to upload — dist-desktop is empty.');
  }
  const paths = all.map((f) => resolve(DIST_DESKTOP, f));
  info(`uploading ${all.length} asset(s) to ${tag}: ${all.join(', ')}`);
  const upload = spawnSync(
    'gh',
    ['release', 'upload', tag, ...paths, '--clobber'],
    {
      stdio: 'inherit',
    },
  );
  if (upload.status !== 0) {
    die(
      'gh release upload failed. Check the gh stderr above; the release tag exists but at least one asset could not be attached.',
    );
  }
  info(`uploaded ${all.length} asset(s) to ${tag}`);
}

/**
 * Mirror of release-windows.mjs's `fetchExistingLatestJson`. Downloads the
 * already-published `latest.json` (if any) into dist-desktop/ so the
 * subsequent `build-update-manifest.mjs --merge-existing` call sees every
 * platform block currently on the GitHub Release — not just whichever
 * happens to be cached locally. Without this, a `pnpm release:macos
 * --upload` on a clean checkout (or after a `dist-desktop/` purge) would
 * silently overwrite the live manifest with a macOS-only file and break
 * auto-update for the other platforms.
 *
 * Permissive: gh missing / release missing / asset missing all degrade
 * to "proceed without prefetch" with a warn/info. We only surface an
 * actual unexpected gh error (auth/network) as a warning.
 */
function fetchExistingLatestJson(version) {
  const tag = `v${version}`;
  const target = resolve(DIST_DESKTOP, 'latest.json');

  if (!existsSync(DIST_DESKTOP)) mkdirSync(DIST_DESKTOP, { recursive: true });

  const ghCheck = spawnSync('gh', ['--version'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (ghCheck.status !== 0) {
    warn(
      'gh CLI not available; skipping latest.json prefetch. Manifest may overwrite other-platform blocks on upload.',
    );
    return;
  }

  const view = spawnSync('gh', ['release', 'view', tag, '--json', 'tagName'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (view.status !== 0) {
    info(`no GitHub release ${tag} yet — manifest will be created from scratch.`);
    return;
  }

  const download = spawnSync(
    'gh',
    [
      'release',
      'download',
      tag,
      '--pattern',
      'latest.json',
      '--output',
      target,
      '--clobber',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
  );
  if (download.status === 0 && existsSync(target)) {
    const size = readFileSync(target, 'utf8').length;
    info(`prefetched ${target} (${size} bytes) — other-platform blocks will be preserved.`);
    return;
  }
  const stderr = (download.stderr ?? '').toString();
  if (/no assets|no asset matches|release not found/i.test(stderr)) {
    info(
      `release ${tag} has no latest.json asset yet — manifest will be created from scratch.`,
    );
    return;
  }
  warn(
    `failed to prefetch latest.json from ${tag}; will proceed with a fresh manifest. gh stderr:\n${stderr.trim() || '(empty)'}`,
  );
}

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

function dmgIsStapled(dmgPath) {
  const r = spawnSync('xcrun', ['stapler', 'validate', dmgPath], {
    stdio: 'pipe',
  });
  return r.status === 0;
}

function notarizeDmg(dmgPath) {
  const r = spawnSync(
    'xcrun',
    [
      'notarytool',
      'submit',
      dmgPath,
      '--key',
      process.env.APPLE_API_KEY_PATH,
      '--key-id',
      process.env.APPLE_API_KEY,
      '--issuer',
      process.env.APPLE_API_ISSUER,
      '--wait',
      '--output-format',
      'json',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  if (r.status !== 0) {
    die(
      `notarytool submit failed for ${basename(dmgPath)} (exit ${r.status}). ` +
        'Re-run with --verbose to see Apple\u2019s progress output, or check ' +
        '`xcrun notarytool history ...` for the most recent submission.',
    );
  }
  const stdout = r.stdout?.toString?.() ?? '';
  try {
    const parsed = JSON.parse(stdout);
    return {
      id: parsed.id ?? 'unknown',
      status: parsed.status ?? 'unknown',
      message: parsed.message ?? '',
    };
  } catch (err) {
    die(
      `failed to parse notarytool JSON output: ${err.message}\n` +
        `  raw stdout:\n${stdout}`,
    );
    return { id: 'unknown', status: 'unknown', message: '' };
  }
}

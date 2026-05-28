#!/usr/bin/env node
/**
 * SlideStage Lite — Windows release orchestrator.
 *
 * Pipeline (Track 2, NSIS-only, unsigned MVP):
 *
 *   1. Load .env.local so TAURI_SIGNING_* vars become available to Tauri's
 *      bundler. The Apple-* vars are deliberately ignored here.
 *   2. Validate environment (TAURI_SIGNING_PRIVATE_KEY{,_PASSWORD} required
 *      unless --skip-updater is passed).
 *   3. Invoke `pnpm tauri build --target x86_64-pc-windows-msvc`. With
 *      `bundle.createUpdaterArtifacts=true` (set in tauri.conf.json) this
 *      emits:
 *        target/<triple>/release/bundle/nsis/<productName>_<version>_x64-setup.exe
 *        target/<triple>/release/bundle/nsis/<productName>_<version>_x64-setup.nsis.zip
 *        target/<triple>/release/bundle/nsis/<productName>_<version>_x64-setup.nsis.zip.sig
 *   4. Rename + copy artifacts to dist-desktop/ using the same hyphenated
 *      scheme we use on macOS (no spaces — some HTTP clients mangle them).
 *   5. Prefetch the already-published `latest.json` from the matching
 *      GitHub release (if any) into dist-desktop/. On GHA this seeds the
 *      `darwin-*` blocks the mac runner uploaded earlier; without this
 *      step --merge-existing has nothing to merge and the Windows upload
 *      would clobber the mac entries on the release.
 *   6. Invoke scripts/build-update-manifest.mjs with --merge-existing so
 *      a previously-generated macOS manifest keeps its `darwin-*` blocks.
 *   7. Optional: `--upload` attaches every dist-desktop artifact to the
 *      matching GitHub Release via `gh release upload`. Same flag as the
 *      mac release script.
 *
 * Why no codesign / SmartScreen handling:
 *   Track 2 is the MVP path — we ship unsigned NSIS installers and rely on
 *   README guidance + SmartScreen reputation accrual. See
 *   docs/WINDOWS_DISTRIBUTION.md for the upgrade path
 *   (Azure Trusted Signing / SignPath / MSIX-via-Store).
 *
 * Required env vars (unless --skip-updater):
 *
 *   TAURI_SIGNING_PRIVATE_KEY           path to / contents of the minisign key
 *   TAURI_SIGNING_PRIVATE_KEY_PASSWORD  password used to encrypt the key
 *
 *   On GHA we pass these as repository secrets and reference them in the
 *   workflow with the same names — Tauri's bundler reads them from the
 *   process environment, so no extra wiring needed.
 *
 *   It is IMPORTANT that the keypair is the same as the one in
 *   tauri.conf.json > plugins.updater.pubkey. The Windows artifact must
 *   be signed by the same key the existing macOS clients trust.
 *
 * Optional:
 *
 *   RELEASE_TARGET                Rust triple to build, defaults to
 *                                 x86_64-pc-windows-msvc. Use
 *                                 aarch64-pc-windows-msvc for ARM64
 *                                 (requires --target rustup to be added).
 *   TAURI_BUNDLE_ARGS             extra args appended to `pnpm tauri build`
 *   UPDATER_ASSET_BASE_URL        override the GitHub Releases base URL
 *                                 embedded into latest.json
 *
 * Usage:
 *
 *   pnpm release:windows
 *   pnpm release:windows --dry-run
 *   pnpm release:windows --skip-updater
 *   pnpm release:windows --upload
 *   RELEASE_TARGET=aarch64-pc-windows-msvc pnpm release:windows
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const TARGET = process.env.RELEASE_TARGET || 'x86_64-pc-windows-msvc';
const TARGET_NAME_SUFFIX = {
  'x86_64-pc-windows-msvc': 'Windows-x64',
  'aarch64-pc-windows-msvc': 'Windows-ARM',
}[TARGET] || TARGET;
const TARGET_BUNDLE_DIR = resolve(
  ROOT,
  'src-tauri/target',
  TARGET,
  'release/bundle/nsis',
);
const DIST_DESKTOP = resolve(ROOT, 'dist-desktop');
const TAURI_CONF = resolve(ROOT, 'src-tauri/tauri.conf.json');
const ENV_LOCAL = resolve(ROOT, '.env.local');
const SHA256SUMS = resolve(DIST_DESKTOP, 'SHA256SUMS.txt');

// ---- Args --------------------------------------------------------------

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has('--dry-run');
const SKIP_UPDATER = ARGS.has('--skip-updater');
const UPLOAD = ARGS.has('--upload');
const VERBOSE = ARGS.has('--verbose') || !!process.env.CI;

// ---- Logging -----------------------------------------------------------

function step(msg) {
  console.log(`\n[release-windows] ▶ ${msg}`);
}

function info(msg) {
  console.log(`[release-windows]   ${msg}`);
}

function warn(msg) {
  console.warn(`[release-windows] ⚠  ${msg}`);
}

function die(msg) {
  console.error(`\n[release-windows] ✖ ${msg}\n`);
  process.exit(1);
}

// ---- .env.local loader (no dotenv dep) ---------------------------------

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

// ---- Bootstrap ---------------------------------------------------------

// We require Windows because Tauri's NSIS bundler shells out to
// makensis.exe and produces .exe installers that only sign correctly
// on Windows. Cross-compilation via cargo-xwin works for the binary
// but not for makensis, so we fail fast here.
if (process.platform !== 'win32') {
  die(
    'Windows release pipeline only runs on win32. Use a Windows VM or the GitHub Actions windows-latest runner. The macOS pipeline is in scripts/release-macos.mjs.',
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
info(`target:          ${TARGET}`);

// ---- Env validation ----------------------------------------------------

function checkEnv(name) {
  const present = !!process.env[name] && process.env[name].length > 0;
  info(`  ${present ? '✓' : '✗'} ${name}${present ? '' : '  (missing)'}`);
  return present;
}

step('Validating environment');

const hasUpdaterKey = checkEnv('TAURI_SIGNING_PRIVATE_KEY');
const hasUpdaterKeyPassword = checkEnv('TAURI_SIGNING_PRIVATE_KEY_PASSWORD');

// Updater key validation: TAURI_SIGNING_PRIVATE_KEY may be either
//   (a) a filesystem path to the minisign keyfile (local dev), or
//   (b) the keyfile contents themselves (CI / GHA secrets).
// The keyfile that `tauri signer generate` emits is a base64-encoded
// blob whose plaintext starts with "untrusted comment:" — so the
// base64 form starts with "dW50cnVzdGVkIGNvbW1lbnQ6". We treat either
// of those signatures (literal plaintext or its base64 envelope) as
// "this is key contents, not a path". If neither matches AND the
// value isn't an existing file, fail fast rather than burn a
// 20-minute build on a sign step that has no chance of succeeding.
const updaterKeyValue = process.env.TAURI_SIGNING_PRIVATE_KEY ?? '';
const looksLikeKeyContent =
  updaterKeyValue.includes('untrusted comment') ||
  updaterKeyValue.startsWith('dW50cnVzdGVkIGNvbW1lbnQ6');
if (
  !SKIP_UPDATER &&
  hasUpdaterKey &&
  !looksLikeKeyContent &&
  !existsSync(updaterKeyValue)
) {
  die(
    `TAURI_SIGNING_PRIVATE_KEY="${updaterKeyValue.slice(0, 40)}…" looks like a path but no file exists there. On CI, pass the raw base64 key contents (the full file, including the "dW50cnVzdGVkIGNvbW1lbnQ6…" header) as the secret value.`,
  );
}

if (!SKIP_UPDATER && !DRY_RUN) {
  if (!hasUpdaterKey) {
    die(
      'TAURI_SIGNING_PRIVATE_KEY is missing. Either:\n' +
        '    a) put it in .env.local (see .env.example), then re-run, or\n' +
        '    b) pass it as a GHA secret named TAURI_SIGNING_PRIVATE_KEY, or\n' +
        '    c) re-run with --skip-updater to ship without an auto-updater artifact.\n' +
        '\n  NOTE: The Windows artifact MUST be signed with the SAME key as the macOS\n' +
        '  builds — otherwise the existing macOS clients will reject the manifest\n' +
        '  and vice-versa. See docs/AUTO_UPDATER.md.',
    );
  }
  if (!hasUpdaterKeyPassword) {
    warn(
      'TAURI_SIGNING_PRIVATE_KEY_PASSWORD is empty. That works only if the keypair was generated without a password (NOT recommended).',
    );
  }
}

if (DRY_RUN) {
  step('Dry run complete — no build performed');
  info(`Would invoke: pnpm tauri build --target ${TARGET}`);
  info(`Would write artifacts to: ${DIST_DESKTOP}`);
  info(
    `Manifest prefetch: ${SKIP_UPDATER ? 'SKIPPED (--skip-updater)' : 'would gh release download v<ver> --pattern latest.json'}`,
  );
  info(
    `Updater step: ${SKIP_UPDATER ? 'SKIPPED (--skip-updater)' : 'would run scripts/build-update-manifest.mjs --merge-existing'}`,
  );
  info(`Upload step: ${UPLOAD ? 'would run gh release upload' : 'skipped (pass --upload to enable)'}`);
  process.exit(0);
}

// ---- Build -------------------------------------------------------------

step(`Building Tauri bundle (--target ${TARGET})`);

const extraArgs = (process.env.TAURI_BUNDLE_ARGS ?? '')
  .split(/\s+/)
  .filter(Boolean);
const buildArgs = ['tauri', 'build', '--target', TARGET, ...extraArgs];

const build = spawnSync('pnpm', buildArgs, {
  stdio: 'inherit',
  cwd: ROOT,
  env: process.env,
  shell: true, // Windows: pnpm.cmd resolves correctly with shell:true
});
if (build.status !== 0) {
  die(`tauri build failed with exit code ${build.status}`);
}

// ---- Locate artifacts --------------------------------------------------

step('Resolving build artifacts');

if (!existsSync(TARGET_BUNDLE_DIR)) {
  die(`expected bundle dir missing: ${TARGET_BUNDLE_DIR}`);
}

// Pin the installer name to the version we just built. The GHA cargo
// cache (keyed loosely on Cargo.lock + tauri.conf.json) can survive a
// version bump if its `restore-keys` prefix matches a previous run, in
// which case the bundle/nsis directory carries the OLD version's
// `<productName>_<oldVersion>_x64-setup.exe` alongside the freshly
// produced `<productName>_<newVersion>_x64-setup.exe`. An unanchored
// `endsWith('-setup.exe')` then picks whichever Node's `readdirSync`
// returned first — on the v0.3.0 Windows runner that turned out to be
// the cached 0.2.1 installer, which we published to GH with a 0.3.0
// filename. Anchoring on `_<version>_x64-setup.exe` is enough because
// Tauri's NSIS template hard-codes the `_<version>_x64-setup.exe`
// suffix and never reuses it for a different version's artifact.
const bundleEntries = readdirSync(TARGET_BUNDLE_DIR);
const setupExeSuffix = `_${versionFromConf}_x64-setup.exe`;
const setupExe = bundleEntries.find((f) => f.endsWith(setupExeSuffix));
if (!setupExe) {
  die(
    `no *${setupExeSuffix} found in ${TARGET_BUNDLE_DIR}. ` +
      `Entries present: ${bundleEntries.join(', ') || '(empty)'}. ` +
      `Did tauri.conf.json get version-bumped before this run?`,
  );
}
const SETUP_EXE_PATH = resolve(TARGET_BUNDLE_DIR, setupExe);
info(`installer: ${SETUP_EXE_PATH}`);

if (!SKIP_UPDATER) {
  // Tauri 2.x's NSIS bundler signs the `.exe` installer in place — the
  // `.nsis.zip` wrapper that Tauri 1.x used is gone. The updater
  // archive IS the same `.exe` we ship as the installer; we only need
  // to confirm the `.sig` sibling exists here so build-update-manifest
  // can pick it up later in the pipeline.
  const setupExeSig = bundleEntries.find((f) =>
    f.endsWith(`${setupExeSuffix}.sig`),
  );
  if (!setupExeSig) {
    die(
      `no *${setupExeSuffix}.sig found in ${TARGET_BUNDLE_DIR}. Did you set bundle.createUpdaterArtifacts=true and TAURI_SIGNING_PRIVATE_KEY? Tauri 2.x emits the signature next to the .exe rather than producing a .nsis.zip wrapper.`,
    );
  }
  info(`updater sig: ${resolve(TARGET_BUNDLE_DIR, setupExeSig)}`);
}

// ---- Publish to dist-desktop -------------------------------------------

step('Publishing to dist-desktop/');

if (!existsSync(DIST_DESKTOP)) mkdirSync(DIST_DESKTOP, { recursive: true });

const FINAL_EXE_NAME = `SlideStageLite-${versionFromConf}-${TARGET_NAME_SUFFIX}-setup.exe`;
const FINAL_EXE_PATH = resolve(DIST_DESKTOP, FINAL_EXE_NAME);
copyFileSync(SETUP_EXE_PATH, FINAL_EXE_PATH);
info(`copied: ${FINAL_EXE_NAME}`);

// ---- Fetch existing latest.json from GitHub release (for cross-platform merge) ----
//
// The macOS pipeline runs on a local mac and uploads dist-desktop/latest.json
// (containing `darwin-aarch64` and `darwin-x86_64` blocks) to the GitHub
// Release before this Windows GHA workflow runs. Without this step the
// GHA runner starts with an EMPTY dist-desktop/ — so `--merge-existing`
// has nothing to merge with, build-update-manifest writes a manifest that
// only contains `windows-x86_64`, and `gh release upload --clobber` would
// then OVERWRITE the mac-block-bearing manifest on the release. mac users'
// in-app updater would silently break.
//
// Fix: download the already-uploaded latest.json (if any) into dist-desktop/
// BEFORE the manifest step, so `--merge-existing` sees the darwin-* blocks
// and preserves them.
//
// We are deliberately permissive on failure: a missing release / missing
// asset is OK for local test builds and for the first-ever publish of a
// version (no mac block exists yet to preserve). Only network/auth errors
// die loudly.

if (!SKIP_UPDATER) {
  step('Fetching existing latest.json from GitHub release (cross-platform merge prep)');
  fetchExistingLatestJson(versionFromConf);
}

// ---- Build updater manifest (latest.json) ------------------------------

if (!SKIP_UPDATER) {
  step(
    'Building updater manifest (latest.json) + publishing .nsis.zip (with --merge-existing)',
  );
  const manifestResult = spawnSync(
    'node',
    [
      resolve(ROOT, 'scripts/build-update-manifest.mjs'),
      '--target',
      TARGET,
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
      'build-update-manifest.mjs exited non-zero. The .exe is still valid but the auto-updater will not pick this release up.',
    );
  }
} else {
  warn('Skipping updater manifest (--skip-updater was passed).');
  // When the updater step is skipped, build-update-manifest.mjs is the
  // canonical source of SHA256SUMS.txt, so we need to refresh by hand
  // (otherwise the .exe we just copied is missing from the file).
  step('Refreshing dist-desktop/SHA256SUMS.txt');
  refreshShaSums();
}

// ---- Optional: upload to GitHub Release --------------------------------

if (UPLOAD) {
  step(`Uploading artifacts to GitHub release v${versionFromConf}`);
  uploadToGithubRelease(versionFromConf);
} else {
  info('Skipping GitHub upload (pass --upload to enable).');
}

step('Done');
info(`Final artifact: ${FINAL_EXE_PATH}`);
if (!SKIP_UPDATER) {
  info('Updater manifest: dist-desktop/latest.json');
}
warn(
  'This build is UNSIGNED. Windows Defender SmartScreen may warn the user with "Unrecognized app". See docs/WINDOWS_DISTRIBUTION.md for the signing upgrade path.',
);

// ---- Helpers -----------------------------------------------------------

function fetchExistingLatestJson(version) {
  const tag = `v${version}`;
  const target = resolve(DIST_DESKTOP, 'latest.json');

  if (!existsSync(DIST_DESKTOP)) mkdirSync(DIST_DESKTOP, { recursive: true });

  // Sanity-check gh is installed; without it, fall through and let
  // build-update-manifest run unprimed (windows-only manifest).
  const ghCheck = spawnSync('gh', ['--version'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  if (ghCheck.status !== 0) {
    warn('gh CLI not available; skipping latest.json prefetch. Manifest will only carry windows-x86_64.');
    return;
  }

  // Does the release exist at all?
  const view = spawnSync(
    'gh',
    ['release', 'view', tag, '--json', 'tagName'],
    { stdio: ['ignore', 'pipe', 'pipe'], shell: true },
  );
  if (view.status !== 0) {
    info(`no GitHub release ${tag} yet — manifest will be created from scratch (windows-x86_64 only).`);
    return;
  }

  // Try to download the asset. gh exits non-zero if the asset doesn't exist,
  // which is also a normal first-publish case (mac runner hasn't uploaded yet).
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
    { stdio: ['ignore', 'pipe', 'pipe'], shell: true, encoding: 'utf8' },
  );
  if (download.status === 0 && existsSync(target)) {
    const size = readFileSync(target, 'utf8').length;
    info(`prefetched ${target} (${size} bytes) — darwin-* blocks will be preserved.`);
    return;
  }
  const stderr = (download.stderr ?? '').toString();
  // gh prints "no assets match" / similar when the manifest isn't on the
  // release yet. Treat that as benign.
  if (/no assets|no asset matches|release not found/i.test(stderr)) {
    info(`release ${tag} has no latest.json asset yet — manifest will be created from scratch (windows-x86_64 only).`);
    return;
  }
  // Anything else (auth, network, permissions) is louder.
  warn(
    `failed to prefetch latest.json from ${tag}; will proceed with a fresh manifest. gh stderr:\n${stderr.trim() || '(empty)'}`,
  );
}

function uploadToGithubRelease(version) {
  const tag = `v${version}`;
  const ghCheck = spawnSync('gh', ['--version'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  if (ghCheck.status !== 0) {
    die(
      'gh CLI is required for --upload but `gh --version` failed. Install with `winget install --id GitHub.cli` and run `gh auth login`.',
    );
  }
  const exists = spawnSync('gh', ['release', 'view', tag], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  if (exists.status !== 0) {
    die(
      `GitHub release ${tag} does not exist yet. Create it first with:\n` +
        `    gh release create ${tag} --title "${tag}" --notes-from-tag\n` +
        `Then re-run with --upload.`,
    );
  }
  // Same regex as release-macos.mjs so the two pipelines agree on
  // exactly which files belong on the GitHub Release. Spaces are
  // refused defensively (Tauri's raw bundle names have one).
  //
  // The SlideStageLite-* match is pinned to the current build's version
  // string so a stale dist-desktop/ (e.g. a previous version's setup.exe
  // surviving the GHA cargo cache) cannot piggy-back onto this release.
  // latest.json / SHA256SUMS.txt are inherently single-version anchors
  // and stay un-pinned.
  const versionPin = version.replace(/[.+]/g, '\\$&');
  const uploadPattern = new RegExp(
    `^(latest\\.json|SHA256SUMS\\.txt|SlideStageLite-${versionPin}-.+\\.(dmg|exe|msi|app\\.tar\\.gz|app\\.tar\\.gz\\.sig|nsis\\.zip|nsis\\.zip\\.sig))$`,
  );
  const all = readdirSync(DIST_DESKTOP)
    .filter((f) => uploadPattern.test(f))
    .filter((f) => !f.includes(' '))
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
      shell: true,
    },
  );
  if (upload.status !== 0) {
    die(
      'gh release upload failed. Check the gh stderr above; the release tag exists but at least one asset could not be attached.',
    );
  }
  info(`uploaded ${all.length} asset(s) to ${tag}`);
}

function refreshShaSums() {
  const trackedExtensions = /\.(dmg|exe|msi|app\.tar\.gz|nsis\.zip|AppImage\.tar\.gz)$/i;
  const entries = readdirSync(DIST_DESKTOP)
    .filter((f) => trackedExtensions.test(f))
    .sort();
  const lines = [];
  for (const file of entries) {
    const filePath = resolve(DIST_DESKTOP, file);
    const buf = readFileSync(filePath);
    const hash = createHash('sha256').update(buf).digest('hex');
    lines.push(`${hash}  ${file}`);
  }
  writeFileSync(SHA256SUMS, `${lines.join('\n')}\n`, 'utf8');
  info(`rewrote ${SHA256SUMS} (${lines.length} entries)`);
}

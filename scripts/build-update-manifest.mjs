#!/usr/bin/env node
/**
 * Assemble the static `latest.json` manifest that drives Tauri's
 * auto-updater.
 *
 * Tauri 2 expects a JSON document with this shape:
 *
 *   {
 *     "version": "0.2.0",
 *     "notes":   "Release notes go here",
 *     "pub_date":"2026-06-01T12:00:00Z",
 *     "platforms": {
 *       "darwin-aarch64": {
 *         "signature": "<contents of *.app.tar.gz.sig>",
 *         "url":       "https://github.com/.../latest/download/<file>.app.tar.gz"
 *       },
 *       "darwin-x86_64":  { ... },
 *       "windows-x86_64": { ... },
 *       "linux-x86_64":   { ... }
 *     }
 *   }
 *
 * The bundler writes `<app>.app.tar.gz` and `<app>.app.tar.gz.sig`
 * next to the regular `.app` and `.dmg` for any target that has
 * `bundle.createUpdaterArtifacts = true`. This script:
 *
 *   1. Reads the version from src-tauri/tauri.conf.json (single source
 *      of truth for the release version).
 *   2. For each requested target triple, locates the matching
 *      `.app.tar.gz` + `.sig` produced by the most recent
 *      `pnpm release:macos` run.
 *   3. Copies those updater artifacts into `dist-desktop/` with a
 *      stable name so we can attach them to the GitHub Release.
 *   4. Writes `dist-desktop/latest.json` with the freshly-extracted
 *      signature contents (NOT the `.sig` path or URL — Tauri rejects
 *      both).
 *
 * Notes-source order (first hit wins):
 *
 *   1. --notes <text>          — direct value
 *   2. --notes-file <path>     — read from a file
 *   3. CHANGELOG.md (top entry)
 *   4. empty string
 *
 * URL convention: GitHub Releases asset URLs follow
 *
 *   https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>
 *
 * The tag must equal `v<version>` (we use `v` prefix everywhere in this
 * repo). If the GitHub Action that publishes the release uses a
 * different naming scheme, override with --asset-base-url.
 *
 * Usage:
 *
 *   pnpm updater:manifest                       # default targets
 *   pnpm updater:manifest --target aarch64-apple-darwin
 *   pnpm updater:manifest --notes "Bug fixes"
 *   pnpm updater:manifest --asset-base-url 'https://updates.example.com/'
 */
import { execSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { resolve, basename } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const TAURI_CONF = resolve(ROOT, 'src-tauri/tauri.conf.json');
const DIST_DESKTOP = resolve(ROOT, 'dist-desktop');
const CHANGELOG = resolve(ROOT, 'CHANGELOG.md');

const GITHUB_OWNER = 'SlideStage';
const GITHUB_REPO = 'SlideStageLite';

// ---- Arg parsing --------------------------------------------------------

const args = process.argv.slice(2);
const argMap = {};
const argList = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg.startsWith('--')) {
    const key = arg.slice(2);
    const value =
      args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
    if (key === 'target') {
      argList.push(value);
    } else {
      argMap[key] = value;
    }
  }
}

const REQUESTED_TARGETS = argList.length
  ? argList
  : ['aarch64-apple-darwin', 'x86_64-apple-darwin'];

const ASSET_BASE_URL =
  argMap['asset-base-url'] ||
  process.env.UPDATER_ASSET_BASE_URL ||
  null; // resolved per-version below when not provided

const NOTES_OVERRIDE = argMap.notes && argMap.notes !== 'true' ? argMap.notes : null;
const NOTES_FILE = argMap['notes-file'] || null;

// ---- Logging ------------------------------------------------------------

function info(msg) {
  console.log(`[updater-manifest] ${msg}`);
}

function warn(msg) {
  console.warn(`[updater-manifest] ⚠  ${msg}`);
}

function die(msg) {
  console.error(`\n[updater-manifest] ✖ ${msg}\n`);
  process.exit(1);
}

// ---- Read version + notes ----------------------------------------------

function readVersion() {
  let conf;
  try {
    conf = JSON.parse(readFileSync(TAURI_CONF, 'utf8'));
  } catch (err) {
    die(`failed to read ${TAURI_CONF}: ${err.message}`);
  }
  if (!conf?.version) die('tauri.conf.json missing "version"');
  return conf.version;
}

function readNotes() {
  if (NOTES_OVERRIDE) return NOTES_OVERRIDE;
  if (NOTES_FILE) {
    try {
      return readFileSync(NOTES_FILE, 'utf8').trim();
    } catch (err) {
      warn(
        `--notes-file ${NOTES_FILE} could not be read (${err.message}); falling back to changelog.`,
      );
    }
  }
  if (existsSync(CHANGELOG)) {
    const raw = readFileSync(CHANGELOG, 'utf8');
    const sections = raw.split(/^##\s+/m);
    if (sections.length > 1) {
      const topSection = sections[1];
      const headerEnd = topSection.indexOf('\n');
      return headerEnd >= 0 ? topSection.slice(headerEnd + 1).trim() : '';
    }
  }
  return '';
}

// ---- Locate updater artifacts ------------------------------------------

const TAURI_TARGET_TO_PLATFORM = {
  'aarch64-apple-darwin': 'darwin-aarch64',
  'x86_64-apple-darwin': 'darwin-x86_64',
  'universal-apple-darwin': 'darwin-universal',
  'x86_64-pc-windows-msvc': 'windows-x86_64',
  'aarch64-pc-windows-msvc': 'windows-aarch64',
  'x86_64-unknown-linux-gnu': 'linux-x86_64',
  'aarch64-unknown-linux-gnu': 'linux-aarch64',
};

const PLATFORM_TO_TARGET_NAME_SUFFIX = {
  'darwin-aarch64': 'AppleSilicon',
  'darwin-x86_64': 'Intel',
  'darwin-universal': 'universal',
  'windows-x86_64': 'Windows-x64',
  'windows-aarch64': 'Windows-ARM',
  'linux-x86_64': 'Linux-x64',
  'linux-aarch64': 'Linux-ARM',
};

function resolveBundleDir(target) {
  // macOS / linux: bundle/macos|appimage|... — for the updater we only
  // care about the .app.tar.gz family, which lives next to the .dmg /
  // .AppImage. Tauri puts them under `bundle/macos/` and
  // `bundle/appimage/` respectively. We probe whichever exists.
  const base = resolve(ROOT, 'src-tauri/target', target, 'release/bundle');
  if (!existsSync(base)) return null;
  for (const sub of ['macos', 'appimage', 'nsis', 'msi']) {
    if (existsSync(resolve(base, sub))) return resolve(base, sub);
  }
  return null;
}

function locateUpdaterArtifacts(target) {
  const bundleDir = resolveBundleDir(target);
  if (!bundleDir) {
    warn(`no bundle directory for target ${target} — skipping.`);
    return null;
  }
  const entries = readdirSync(bundleDir);
  // We expect exactly one *.app.tar.gz alongside its *.sig sibling. The
  // bundler names them after `productName`, e.g. `SlideStage Lite.app.tar.gz`.
  const archive = entries.find((f) => f.endsWith('.app.tar.gz'))
    || entries.find((f) => f.endsWith('.nsis.zip'))
    || entries.find((f) => f.endsWith('.AppImage.tar.gz'));
  if (!archive) {
    warn(
      `${bundleDir} has no .app.tar.gz / .nsis.zip / .AppImage.tar.gz — did you set bundle.createUpdaterArtifacts=true and rebuild?`,
    );
    return null;
  }
  const archivePath = resolve(bundleDir, archive);
  const sigPath = `${archivePath}.sig`;
  if (!existsSync(sigPath)) {
    warn(
      `${archive} found but ${basename(sigPath)} is missing — make sure TAURI_SIGNING_PRIVATE_KEY{,_PASSWORD} were set during build.`,
    );
    return null;
  }
  return { archivePath, sigPath };
}

// ---- Main ---------------------------------------------------------------

function main() {
  if (!existsSync(DIST_DESKTOP)) mkdirSync(DIST_DESKTOP, { recursive: true });

  const version = readVersion();
  const notes = readNotes();
  const pubDate = new Date().toISOString();
  const tag = `v${version}`;
  const baseUrl =
    ASSET_BASE_URL ??
    `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${tag}/`;

  info(`version: ${version}`);
  info(`tag:     ${tag}`);
  info(`baseUrl: ${baseUrl}`);
  info(`pub_date: ${pubDate}`);
  info(`targets: ${REQUESTED_TARGETS.join(', ')}`);

  const platforms = {};
  const publishedAssets = [];

  for (const target of REQUESTED_TARGETS) {
    const platformKey = TAURI_TARGET_TO_PLATFORM[target];
    if (!platformKey) {
      warn(
        `unknown Tauri target triple "${target}" — Tauri updater requires one of ${Object.keys(TAURI_TARGET_TO_PLATFORM).join(', ')}`,
      );
      continue;
    }
    const located = locateUpdaterArtifacts(target);
    if (!located) continue;
    const { archivePath, sigPath } = located;
    const suffix = PLATFORM_TO_TARGET_NAME_SUFFIX[platformKey] ?? platformKey;
    // Stable artifact name attached to the GitHub Release. The
    // bundler's name has a space ("SlideStage Lite.app.tar.gz") which
    // can mangle on some HTTP clients, so we rename to the same
    // hyphenated scheme we already use for the DMG.
    const publishedName = `SlideStageLite-${version}-${suffix}.app.tar.gz`;
    const publishedPath = resolve(DIST_DESKTOP, publishedName);
    copyFileSync(archivePath, publishedPath);
    copyFileSync(sigPath, `${publishedPath}.sig`);
    publishedAssets.push(publishedName, `${publishedName}.sig`);
    const signature = readFileSync(sigPath, 'utf8').trim();
    if (!signature) {
      warn(`signature file for ${target} is empty — refusing to publish.`);
      continue;
    }
    platforms[platformKey] = {
      signature,
      url: `${baseUrl}${publishedName}`,
    };
    info(`  ✓ ${platformKey} → ${publishedName}`);
  }

  if (Object.keys(platforms).length === 0) {
    die(
      'no platform entries could be assembled. Did you run `pnpm release:macos` first, with TAURI_SIGNING_PRIVATE_KEY set?',
    );
  }

  const manifest = {
    version,
    notes,
    pub_date: pubDate,
    platforms,
  };

  const manifestPath = resolve(DIST_DESKTOP, 'latest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  info(`wrote ${manifestPath}`);

  // Refresh SHA256SUMS.txt so it stays in sync with what's actually in
  // dist-desktop/. We don't hash latest.json or the .sig files (they're
  // tiny and naturally tamper-evident via the manifest signature itself).
  refreshShaSums(version, publishedAssets);
}

function refreshShaSums(version, publishedAssets) {
  const sumsPath = resolve(DIST_DESKTOP, 'SHA256SUMS.txt');
  const trackedExtensions = /\.(dmg|exe|msi|app\.tar\.gz)$/i;
  const entries = readdirSync(DIST_DESKTOP)
    .filter((f) => trackedExtensions.test(f))
    .sort();
  const lines = [];
  for (const file of entries) {
    const filePath = resolve(DIST_DESKTOP, file);
    const hash = execSync(`shasum -a 256 "${filePath}"`).toString().trim();
    lines.push(hash.replace(/\s+.*$/, `  ${file}`));
  }
  writeFileSync(sumsPath, `${lines.join('\n')}\n`, 'utf8');
  info(
    `refreshed ${sumsPath} with ${lines.length} entries (added ${publishedAssets.filter((n) => !n.endsWith('.sig')).length} updater archives)`,
  );
}

main();

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
 *   pnpm updater:manifest --target x86_64-pc-windows-msvc
 *   pnpm updater:manifest --notes "Bug fixes"
 *   pnpm updater:manifest --asset-base-url 'https://updates.example.com/'
 *   pnpm updater:manifest --merge-existing      # \u589e\u91cf\u5408\u5e76\u5230\u73b0\u6709 latest.json
 *
 * \u4f7f\u7528 --merge-existing \u5f53\u4e0d\u540c\u5e73\u53f0\u5728\u4e0d\u540c\u673a\u5668\u4e0a\u751f\u4ea7\u65f6\uff08\u6bd4\u5982\n * mac \u672c\u5730 + Windows GHA\uff09\uff0c\u4ee5\u4fdd\u7559\u5176\u4ed6\u5e73\u53f0\u5757\u3002\u4e24\u8fb9 manifest \u7684\n * `version` \u5b57\u6bb5\u5fc5\u987b\u4e25\u683c\u76f8\u7b49\uff0c\u5426\u5219\u811a\u672c\u4f1a die\uff08\u907f\u514d\u628a\n * 0.2.0 \u7684 mac \u5757\u610f\u5916\u5b9a\u5165 0.3.0 \u7684\u65b0 manifest\uff09\u3002\n */
import { createHash } from 'node:crypto';
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
const MERGE_EXISTING = argMap['merge-existing'] === 'true';

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

// Per-archive-suffix metadata: which file extension the updater bundler
// produces for that target family, and what stable extension we publish
// it under in dist-desktop/. Order matters — we probe the array in order
// and use the first archive we find in the bundle directory.
//
// Notes:
//   - Tauri 2.x ships the Windows updater signature next to the `.exe`
//     installer (the `.nsis.zip` wrapper from 1.x is gone). We match
//     `-setup.exe` specifically so we don't grab `slidestage-lite-
//     desktop.exe` or any other stray executable in the bundle dir.
//   - For Windows, publishedExt is `-setup.exe` and the publishedName
//     builder below treats it as a full filename suffix (hyphen-joined,
//     not dot-joined) so the installer URL stays human-readable as
//     `SlideStageLite-0.2.1-Windows-x64-setup.exe`.
const ARCHIVE_SUFFIXES = [
  { match: '.app.tar.gz', publishedExt: 'app.tar.gz' },
  { match: '-setup.exe', publishedExt: '-setup.exe' },
  { match: '.AppImage.tar.gz', publishedExt: 'AppImage.tar.gz' },
];

function locateUpdaterArtifacts(target) {
  const bundleDir = resolveBundleDir(target);
  if (!bundleDir) {
    warn(`no bundle directory for target ${target} — skipping.`);
    return null;
  }
  const entries = readdirSync(bundleDir);
  let archive = null;
  let publishedExt = null;
  for (const { match, publishedExt: ext } of ARCHIVE_SUFFIXES) {
    const hit = entries.find((f) => f.endsWith(match));
    if (hit) {
      archive = hit;
      publishedExt = ext;
      break;
    }
  }
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
  return { archivePath, sigPath, publishedExt };
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
    const { archivePath, sigPath, publishedExt } = located;
    const suffix = PLATFORM_TO_TARGET_NAME_SUFFIX[platformKey] ?? platformKey;
    // Stable artifact name attached to the GitHub Release. The
    // bundler's name has a space ("SlideStage Lite.app.tar.gz") which
    // can mangle on some HTTP clients, so we rename to the same
    // hyphenated scheme we already use for the DMG. The extension is
    // chosen per platform family (app.tar.gz on macOS, -setup.exe on
    // Windows, AppImage.tar.gz on Linux) so the URL in latest.json
    // points to the right Tauri-recognised archive type.
    //
    // Windows is special: `-setup.exe` IS the installer (no separate
    // .nsis.zip wrapper in Tauri 2.x), so we glue it on without a dot
    // to keep the file looking like a normal installer download. Other
    // extensions get the conventional `.<ext>` join.
    const publishedName = publishedExt.startsWith('-')
      ? `SlideStageLite-${version}-${suffix}${publishedExt}`
      : `SlideStageLite-${version}-${suffix}.${publishedExt}`;
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

  // --merge-existing: when the macOS pipeline and the Windows pipeline
  // run on separate machines (typically mac local + Windows GHA), the
  // second runner sees a `latest.json` that already contains the first
  // runner's platform block. Wholesale-overwriting it would drop that
  // block and break auto-update on the platform that ran first. We
  // merge by `platforms` key, keeping any blocks the new run did not
  // produce. The `version` field MUST agree on both sides — a mismatch
  // means somebody bumped the version on one side but not the other,
  // and we'd rather fail loudly than ship a Frankenstein manifest.
  const manifestPath = resolve(DIST_DESKTOP, 'latest.json');
  let mergedPlatforms = platforms;
  let mergedNotes = notes;
  let mergedPubDate = pubDate;
  if (MERGE_EXISTING && existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (existing.version && existing.version !== version) {
        die(
          `--merge-existing: existing latest.json has version "${existing.version}" but this build is ${version}. Bump both sides to the same version before merging.`,
        );
      }
      mergedPlatforms = { ...(existing.platforms ?? {}), ...platforms };
      // Notes / pub_date: prefer the new values when explicitly
      // provided, otherwise keep whatever was there. This keeps the
      // first run's release notes intact across follow-up platform
      // builds that don't supply --notes.
      if (!NOTES_OVERRIDE && !NOTES_FILE && existing.notes) {
        mergedNotes = existing.notes;
      }
      if (existing.pub_date) {
        mergedPubDate = existing.pub_date;
      }
      info(
        `merged with existing ${manifestPath} (kept platforms: ${Object.keys(
          existing.platforms ?? {},
        )
          .filter((k) => !(k in platforms))
          .join(', ') || '(none)'})`,
      );
    } catch (err) {
      die(`--merge-existing: failed to parse ${manifestPath}: ${err.message}`);
    }
  }

  const manifest = {
    version,
    notes: mergedNotes,
    pub_date: mergedPubDate,
    platforms: mergedPlatforms,
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  info(`wrote ${manifestPath}`);

  // Refresh SHA256SUMS.txt so it stays in sync with what's actually in
  // dist-desktop/. We don't hash latest.json or the .sig files (they're
  // tiny and naturally tamper-evident via the manifest signature itself).
  refreshShaSums(version, publishedAssets);
}

function refreshShaSums(version, publishedAssets) {
  const sumsPath = resolve(DIST_DESKTOP, 'SHA256SUMS.txt');
  const trackedExtensions = /\.(dmg|exe|msi|app\.tar\.gz|nsis\.zip|AppImage\.tar\.gz)$/i;
  const entries = readdirSync(DIST_DESKTOP)
    .filter((f) => trackedExtensions.test(f))
    .sort();
  const lines = [];
  for (const file of entries) {
    const filePath = resolve(DIST_DESKTOP, file);
    // Node-native hash so this works on Windows runners too (where
    // `shasum -a 256` is not on PATH by default).
    const buf = readFileSync(filePath);
    const hash = createHash('sha256').update(buf).digest('hex');
    lines.push(`${hash}  ${file}`);
  }
  writeFileSync(sumsPath, `${lines.join('\n')}\n`, 'utf8');
  info(
    `refreshed ${sumsPath} with ${lines.length} entries (added ${publishedAssets.filter((n) => !n.endsWith('.sig')).length} updater archives)`,
  );
}

main();

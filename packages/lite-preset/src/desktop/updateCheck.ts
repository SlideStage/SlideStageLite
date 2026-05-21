/**
 * Passive update checker for self-distributed (GitHub Releases) builds.
 *
 * Why this module exists:
 *   SlideStage Lite ships outside the Mac App Store as a notarized DMG
 *   on GitHub Releases. Without an explicit update path the user has no
 *   way to know a newer version exists. The Tauri 2 "updater" plugin
 *   solves this for auto-installing flows but requires a separate
 *   signing-keypair + manifest service — overkill for our cadence.
 *
 *   Instead we do the lightest thing that works: at startup, hit the
 *   public GitHub Releases API for the latest release, compare its
 *   semver tag to the running version, and surface a sticky-but-
 *   dismissible banner. Clicking the banner opens the release page in
 *   the OS browser (via `openExternal` → `tauri-plugin-opener`).
 *
 *   Web builds never call this code: there is no `tauri-apps/api/app`
 *   to dynamic-import, no DMG to download, and the web app updates
 *   itself on every server deploy.
 *
 * Failure mode contract:
 *   - Network failure → no banner, no error UI, single console.warn.
 *   - GitHub rate-limited (60 req/h unauth) → silently skip.
 *   - Tag that does not parse as semver → silently skip.
 *   - User explicitly dismissed this version → silently skip until a
 *     newer release appears (dismiss is keyed by version, not "ever").
 *
 * Everything related to Tauri is dynamic-imported so the Web bundle
 * stays clean of `@tauri-apps/*` modules.
 */
import { isTauri } from './env';

/** GitHub repository for the official Lite distribution. */
export const DEFAULT_RELEASE_REPO = 'SlideStage/SlideStageLite';

/** localStorage key — value is the `tag` of the most recently dismissed update. */
export const UPDATE_DISMISS_STORAGE_KEY = 'slidestage-lite:update-dismiss';

/**
 * Minimal subset of a GitHub `releases/latest` payload that we care
 * about. We deliberately don't pull in a typed GitHub client here — the
 * payload surface we use is tiny and stable.
 */
export interface ReleaseInfo {
  /** Original tag (e.g. `"v0.2.0"`). Useful for the dismiss key. */
  tag: string;
  /** Tag with a leading `v` stripped (e.g. `"0.2.0"`). */
  version: string;
  /** HTML URL of the release page on github.com. */
  releaseUrl: string;
  /** ISO-8601 published timestamp from GitHub. */
  publishedAt: string;
  /** Optional release notes (may be empty). */
  notes: string;
}

/**
 * Parsed semver triple. Pre-release/build metadata are dropped — the
 * comparison only needs major/minor/patch, and we treat a pre-release
 * version as **older** than the same major.minor.patch baseline so a
 * stable release of the same number is correctly flagged as new.
 */
interface SemverParts {
  major: number;
  minor: number;
  patch: number;
  /** "" for a stable release, otherwise the pre-release identifier. */
  pre: string;
}

function parseSemver(input: string): SemverParts | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  const stripped = trimmed.startsWith('v') ? trimmed.slice(1) : trimmed;
  // Accept "0.1.0", "0.1.0-rc.1", "0.1.0+build.42". Reject anything that
  // does not at least have three numeric segments separated by dots.
  const match = stripped.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ?? '',
  };
}

/**
 * Compare two semver strings (with optional leading `v`).
 *
 * Returns a negative number when `a < b`, zero when they are equal,
 * positive when `a > b`. Returns `0` (treated as "no update") when
 * either input fails to parse — we'd rather miss an update than
 * surface a confusing banner for an unknown version.
 */
export function compareSemver(a: string, b: string): number {
  const ap = parseSemver(a);
  const bp = parseSemver(b);
  if (!ap || !bp) return 0;
  if (ap.major !== bp.major) return ap.major - bp.major;
  if (ap.minor !== bp.minor) return ap.minor - bp.minor;
  if (ap.patch !== bp.patch) return ap.patch - bp.patch;
  // Stable > pre-release; both stable → equal; both pre-release → lex.
  if (ap.pre === bp.pre) return 0;
  if (ap.pre === '') return 1;
  if (bp.pre === '') return -1;
  return ap.pre < bp.pre ? -1 : 1;
}

/**
 * Pull the running app's version. Returns `null` outside Tauri (web
 * builds have no concept of a "release version" — the bundle is
 * whatever the CDN served last). The import is dynamic so the Tauri
 * runtime client never lands in the Web chunk.
 */
export async function getCurrentDesktopVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const mod = (await import('@tauri-apps/api/app')) as {
      getVersion: () => Promise<string>;
    };
    return await mod.getVersion();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('getCurrentDesktopVersion failed', err);
    return null;
  }
}

/**
 * Hit the GitHub Releases API for the latest stable release of a repo.
 *
 * Notes:
 *   - We send `Accept: application/vnd.github+json` and `X-GitHub-Api-
 *     Version: 2022-11-28` to lock the response shape against future
 *     GitHub Mardown-rendering changes that would otherwise reshape
 *     `body`.
 *   - We do NOT send a Personal Access Token. The unauth quota (60
 *     req/h per IP) is fine for a startup-only check.
 *   - `releases/latest` already filters out drafts and pre-releases on
 *     GitHub's side, which is exactly what we want for the auto-banner.
 *     Power users can still grab a beta from `/releases`.
 */
export async function fetchLatestRelease(
  repo: string,
  signal?: AbortSignal,
): Promise<ReleaseInfo | null> {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal,
      // Be friendly to corporate proxies that disallow credentials on
      // cross-origin requests.
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (err) {
    if (signal?.aborted) return null;
    // eslint-disable-next-line no-console
    console.warn('fetchLatestRelease network error', err);
    return null;
  }
  if (!response.ok) {
    // 404 means the repo has no releases yet — that's the common case
    // before the first ship, not a bug worth logging loudly.
    if (response.status !== 404) {
      // eslint-disable-next-line no-console
      console.warn(
        `fetchLatestRelease HTTP ${response.status} for ${repo}`,
      );
    }
    return null;
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('fetchLatestRelease JSON parse failed', err);
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const tag = typeof obj.tag_name === 'string' ? obj.tag_name : '';
  const releaseUrl = typeof obj.html_url === 'string' ? obj.html_url : '';
  const publishedAt =
    typeof obj.published_at === 'string' ? obj.published_at : '';
  const notes = typeof obj.body === 'string' ? obj.body : '';
  if (!tag || !releaseUrl) return null;
  return {
    tag,
    version: tag.startsWith('v') ? tag.slice(1) : tag,
    releaseUrl,
    publishedAt,
    notes,
  };
}

/**
 * High-level: "is there a newer release than what we're running?".
 * Returns `null` when there is no update, we can't tell, or the user
 * has dismissed this exact tag.
 *
 * @param opts.repo       GitHub `owner/repo`. Defaults to the official
 *                        Lite distribution.
 * @param opts.current    Override the auto-detected current version.
 *                        Mostly useful for tests.
 * @param opts.signal     Cancel mid-flight (e.g. component unmounted).
 */
export interface CheckForUpdateOptions {
  repo?: string;
  current?: string | null;
  signal?: AbortSignal;
}

export async function checkForUpdate(
  opts: CheckForUpdateOptions = {},
): Promise<ReleaseInfo | null> {
  const repo = opts.repo ?? DEFAULT_RELEASE_REPO;
  const currentRaw =
    opts.current === undefined
      ? await getCurrentDesktopVersion()
      : opts.current;
  if (!currentRaw) return null;
  const latest = await fetchLatestRelease(repo, opts.signal);
  if (!latest) return null;
  if (compareSemver(latest.version, currentRaw) <= 0) return null;
  if (isDismissed(latest.tag)) return null;
  return latest;
}

/**
 * Remember that the user dismissed a specific release tag so we don't
 * keep nagging on every cold start. Stored per-tag so a future release
 * automatically un-suppresses the banner.
 */
export function dismissUpdate(tag: string): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(UPDATE_DISMISS_STORAGE_KEY, tag);
  } catch {
    // Storage may be disabled / quota-exceeded; degrade silently.
  }
}

export function isDismissed(tag: string): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const stored = window.localStorage.getItem(UPDATE_DISMISS_STORAGE_KEY);
    return stored === tag;
  } catch {
    return false;
  }
}

/**
 * Test seam — clears the persisted dismiss so a fresh probe sees a
 * pristine state.
 */
export function __resetUpdateDismissForTests(): void {
  try {
    window.localStorage.removeItem(UPDATE_DISMISS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

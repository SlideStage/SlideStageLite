/**
 * Unit tests for the GitHub Release update probe.
 *
 * The module under test is intentionally tiny and dependency-free
 * (parse a semver, compare two, fetch JSON, remember a dismiss).
 * We cover:
 *   1. Semver comparison — major/minor/patch ordering, v-prefix, equal
 *      versions, pre-release vs stable, malformed input.
 *   2. `fetchLatestRelease` — happy path, HTTP 404, HTTP 5xx, malformed
 *      JSON, abort signal.
 *   3. `checkForUpdate` — returns the release when newer, returns null
 *      when same, null when older, null when dismissed.
 *   4. `dismissUpdate` / `isDismissed` — round-trip via localStorage,
 *      survives storage failure.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  __resetUpdateDismissForTests,
  checkForUpdate,
  compareSemver,
  dismissUpdate,
  fetchLatestRelease,
  isDismissed,
  UPDATE_DISMISS_STORAGE_KEY,
} from '@slidestage/lite-preset/desktop/updateCheck';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('compareSemver', () => {
  it('orders major.minor.patch correctly', () => {
    expect(compareSemver('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compareSemver('1.3.0', '1.2.9')).toBeGreaterThan(0);
    expect(compareSemver('2.0.0', '1.99.99')).toBeGreaterThan(0);
  });

  it('treats v-prefix as cosmetic', () => {
    expect(compareSemver('v1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('v1.2.3', '1.2.4')).toBeLessThan(0);
  });

  it('treats identical versions as equal', () => {
    expect(compareSemver('0.1.0', '0.1.0')).toBe(0);
  });

  it('ranks pre-release lower than stable for the same triple', () => {
    expect(compareSemver('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
    expect(compareSemver('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0);
  });

  it('falls back to lex ordering between two pre-releases of the same triple', () => {
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-beta.1')).toBeLessThan(0);
  });

  it('returns 0 for malformed input (so we never falsely flag an update)', () => {
    expect(compareSemver('not-a-version', '0.1.0')).toBe(0);
    expect(compareSemver('0.1.0', 'not-a-version')).toBe(0);
    expect(compareSemver('0.1', '0.1.0')).toBe(0);
  });
});

describe('fetchLatestRelease', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extracts tag + version + url + body from a happy-path payload', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        tag_name: 'v0.2.0',
        html_url: 'https://github.com/SlideStage/SlideStageLite/releases/tag/v0.2.0',
        published_at: '2026-06-01T12:00:00Z',
        body: 'Speaker tools polish.',
      }),
    );
    const release = await fetchLatestRelease('SlideStage/SlideStageLite');
    expect(release).not.toBeNull();
    expect(release).toMatchObject({
      tag: 'v0.2.0',
      version: '0.2.0',
      releaseUrl:
        'https://github.com/SlideStage/SlideStageLite/releases/tag/v0.2.0',
      publishedAt: '2026-06-01T12:00:00Z',
      notes: 'Speaker tools polish.',
    });
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe(
      'https://api.github.com/repos/SlideStage/SlideStageLite/releases/latest',
    );
    expect(call[1]?.method).toBe('GET');
  });

  it('returns null on HTTP 404 (no releases yet)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('', { status: 404 }),
    );
    const r = await fetchLatestRelease('SlideStage/SlideStageLite');
    expect(r).toBeNull();
  });

  it('returns null on HTTP 5xx (rate limit, outage, …)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('rate limited', { status: 503 }),
    );
    const r = await fetchLatestRelease('SlideStage/SlideStageLite');
    expect(r).toBeNull();
  });

  it('returns null on malformed JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('this is not json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const r = await fetchLatestRelease('SlideStage/SlideStageLite');
    expect(r).toBeNull();
  });

  it('returns null when the response lacks tag_name', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        html_url: 'https://example.com/r',
      }),
    );
    expect(await fetchLatestRelease('owner/repo')).toBeNull();
  });

  it('returns null on a network throw', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const r = await fetchLatestRelease('owner/repo');
    expect(r).toBeNull();
  });
});

describe('checkForUpdate', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    __resetUpdateDismissForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetUpdateDismissForTests();
  });

  it('returns the release when the published version is strictly newer', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        tag_name: 'v0.2.0',
        html_url: 'https://example.com/r',
        published_at: '2026-06-01T12:00:00Z',
        body: '',
      }),
    );
    const release = await checkForUpdate({
      repo: 'owner/repo',
      current: '0.1.0',
    });
    expect(release?.version).toBe('0.2.0');
  });

  it('returns null when the published version equals the running one', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        tag_name: 'v0.1.0',
        html_url: 'https://example.com/r',
        published_at: '2026-06-01T12:00:00Z',
        body: '',
      }),
    );
    const release = await checkForUpdate({
      repo: 'owner/repo',
      current: '0.1.0',
    });
    expect(release).toBeNull();
  });

  it('returns null when the running version is newer (dev builds)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        tag_name: 'v0.1.0',
        html_url: 'https://example.com/r',
        published_at: '2026-06-01T12:00:00Z',
        body: '',
      }),
    );
    const release = await checkForUpdate({
      repo: 'owner/repo',
      current: '0.2.0',
    });
    expect(release).toBeNull();
  });

  it('returns null when the user has dismissed that exact tag', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        tag_name: 'v0.2.0',
        html_url: 'https://example.com/r',
        published_at: '2026-06-01T12:00:00Z',
        body: '',
      }),
    );
    dismissUpdate('v0.2.0');
    const release = await checkForUpdate({
      repo: 'owner/repo',
      current: '0.1.0',
    });
    expect(release).toBeNull();
  });

  it('un-suppresses dismissal when a newer tag arrives', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        tag_name: 'v0.3.0',
        html_url: 'https://example.com/r',
        published_at: '2026-06-01T12:00:00Z',
        body: '',
      }),
    );
    dismissUpdate('v0.2.0');
    const release = await checkForUpdate({
      repo: 'owner/repo',
      current: '0.1.0',
    });
    expect(release?.tag).toBe('v0.3.0');
  });

  it('returns null when no current version can be resolved', async () => {
    const release = await checkForUpdate({
      repo: 'owner/repo',
      current: null,
    });
    expect(release).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('dismissUpdate / isDismissed', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips the tag via localStorage', () => {
    dismissUpdate('v0.5.0');
    expect(window.localStorage.getItem(UPDATE_DISMISS_STORAGE_KEY)).toBe(
      'v0.5.0',
    );
    expect(isDismissed('v0.5.0')).toBe(true);
    expect(isDismissed('v0.6.0')).toBe(false);
  });

  it('treats missing storage gracefully', () => {
    expect(isDismissed('v0.5.0')).toBe(false);
  });

  it('survives storage that throws on access', () => {
    // Use vi.spyOn so the mock is restored automatically when the spy
    // goes out of scope — manually patching Storage.prototype is racy
    // if any other test in the worker happens to touch localStorage
    // between the patch and the restore.
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota');
      });
    try {
      expect(() => dismissUpdate('v0.5.0')).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});

import { BASE_SANDBOX_TOKEN, TRUST_CAPABILITIES, type TrustCapability } from './constants';

export interface TrustCapabilityInfo {
  id: TrustCapability;
  title: string;
  description: string;
  /**
   * Iframe sandbox tokens the capability adds on top of the always-on
   * `allow-scripts` base. Multiple capabilities may contribute the same
   * token; {@link sandboxTokensFor} deduplicates the union.
   */
  sandboxTokens: ReadonlyArray<string>;
}

export const CAPABILITY_REGISTRY: Readonly<Record<TrustCapability, TrustCapabilityInfo>> = {
  'same-origin-storage': {
    id: 'same-origin-storage',
    title: 'Same-origin storage',
    description:
      'Read and write cookies, localStorage and IndexedDB scoped to this site, ' +
      'and share state with sibling tabs of the same deck.',
    sandboxTokens: ['allow-same-origin'],
  },
  'broadcast-channel': {
    id: 'broadcast-channel',
    title: 'Cross-tab coordination',
    description:
      'Send and receive BroadcastChannel messages between tabs ' +
      '(requires same-origin scripting).',
    sandboxTokens: ['allow-same-origin'],
  },
  'window-open': {
    id: 'window-open',
    title: 'Open new browser windows',
    description:
      'Pop a new browser window or tab (for presenter / audience splits, ' +
      'external previews, or hand-offs).',
    sandboxTokens: ['allow-popups', 'allow-popups-to-escape-sandbox'],
  },
};

const KNOWN_CAPABILITIES = new Set<TrustCapability>(TRUST_CAPABILITIES);

/**
 * Filter, dedupe, and sort the capability list off the manifest. Anything
 * we do not know about is dropped (the loader can warn separately if it
 * cares).
 */
export function normalizeCapabilities(
  requested: ReadonlyArray<TrustCapability | string> | undefined,
): TrustCapability[] {
  if (!requested || requested.length === 0) return [];
  const out: TrustCapability[] = [];
  const seen = new Set<TrustCapability>();
  for (const candidate of requested) {
    if (typeof candidate !== 'string') continue;
    if (!KNOWN_CAPABILITIES.has(candidate as TrustCapability)) continue;
    const id = candidate as TrustCapability;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  out.sort();
  return out;
}

/**
 * Compute the iframe `sandbox` attribute string for a given grant. The
 * base `allow-scripts` token is always included. Granting an empty list
 * is the same as the loader default.
 */
export function sandboxTokensFor(
  granted: ReadonlyArray<TrustCapability> | undefined,
): string {
  const tokens = new Set<string>([BASE_SANDBOX_TOKEN]);
  for (const cap of granted ?? []) {
    const entry = CAPABILITY_REGISTRY[cap];
    if (!entry) continue;
    for (const token of entry.sandboxTokens) {
      tokens.add(token);
    }
  }
  return Array.from(tokens).join(' ');
}

/**
 * Set-equality between two capability lists. Order-insensitive. Used by
 * the trust store to decide whether a remembered grant still covers what
 * the deck now declares (a producer adding `window-open` later must
 * re-prompt).
 */
export function capabilitiesEqual(
  a: ReadonlyArray<TrustCapability>,
  b: ReadonlyArray<TrustCapability>,
): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  for (const cap of b) {
    if (!left.has(cap)) return false;
  }
  return true;
}

export function describeCapability(cap: TrustCapability): TrustCapabilityInfo {
  return CAPABILITY_REGISTRY[cap];
}

/**
 * Returns true when the sandbox token list grants `allow-same-origin`.
 *
 * The viewer uses this to decide whether to render a slide via
 * `<iframe src={virtualUrl}>` (service worker route, only honoured by
 * Chrome for same-origin iframes) or via `<iframe srcdoc={html}>` (the
 * always-safe data-URL-inlined fallback). Sandboxed iframes without
 * `allow-same-origin` have an opaque ("null") origin which Chrome
 * explicitly bypasses for service worker fetch interception, so they
 * MUST go through srcdoc no matter how nicely the SW is wired up.
 */
export function sandboxAllowsSameOrigin(sandbox: string | undefined | null): boolean {
  if (!sandbox) return false;
  return sandbox
    .split(/\s+/)
    .filter(Boolean)
    .includes('allow-same-origin');
}

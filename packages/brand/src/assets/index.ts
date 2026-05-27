// Asset URL aggregator. Each per-product subpath exports a constant whose
// values are absolute URLs (resolved via `new URL(..., import.meta.url)`),
// which means consumers can pass them directly to `<img src>` in Node, the
// browser, or any bundler that respects ESM `import.meta.url`.

import { LITE_BRAND_ASSETS } from './lite.js';
import { PRO_BRAND_ASSETS } from './pro.js';
import { PACK_BRAND_ASSETS } from './pack.js';

export * from './lite.js';
export * from './pro.js';
export * from './pack.js';

/** Logical product slug used to switch between brand surfaces. */
export type SlideStageBrandSurface = 'lite' | 'pro' | 'pack';

/** Aggregate brand asset table keyed by product surface. */
export const SLIDESTAGE_BRAND_ASSETS = {
  lite: LITE_BRAND_ASSETS,
  pro: PRO_BRAND_ASSETS,
  pack: PACK_BRAND_ASSETS,
} as const;

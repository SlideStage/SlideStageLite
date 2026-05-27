/**
 * SlideStage product registry — single source of truth for the family of
 * shipping products under the SlideStage brand. The list is consumed by the
 * `tools/render-ecosystem.mjs` tool to keep every repo's README ecosystem
 * table in sync, and is exported so downstream consumers (docs sites,
 * marketing surfaces, signup flows) can iterate the family without re-typing
 * the metadata.
 *
 * The data lives in `./products.data.mjs` so that Node CLI tooling can
 * `import` the registry without a TypeScript build step. This module simply
 * re-exports that data with a typed signature.
 *
 * Adding a new product:
 *   1. Append a new entry in `products.data.mjs`.
 *   2. Bump this package's version and publish.
 *   3. Run `pnpm render:ecosystem` in every consumer repo and commit the
 *      regenerated README block.
 *
 * Field semantics:
 *   - `slug`:        kebab-case identifier (used in URLs and asset filenames).
 *   - `name`:        full product name as shown to humans (e.g. "SlideStage Lite").
 *   - `tagline`:     one-line role descriptor (e.g. "Local-first runtime").
 *   - `summary`:     ≤120 char marketing summary, rendered inside the table.
 *   - `summaryZh`:   simplified Chinese mirror of `summary`.
 *   - `repo`:        public GitHub URL.
 *   - `kind`:        `'app'` for shippable product apps, `'package'` for
 *                    foundation npm packages reused across the family.
 *   - `markPng`:     filename (under `assets/png/`) of the 84×84-ish product
 *                    mark used as the table cell image.
 *   - `npm`:         optional npm package name (for `kind === 'package'` or
 *                    when an app also publishes an npm artifact).
 *   - `homepage`:    optional non-GitHub canonical URL (marketing site).
 */
import { SLIDESTAGE_PRODUCTS_DATA } from './products.data.mjs';

export interface SlideStageProduct {
  readonly slug: string;
  readonly name: string;
  readonly tagline: string;
  readonly summary: string;
  readonly summaryZh: string;
  readonly repo: string;
  readonly kind: 'app' | 'package';
  readonly markPng: string;
  readonly npm?: string;
  readonly homepage?: string;
}

/**
 * Ordered list of products. Order is meaningful — `render-ecosystem.mjs`
 * preserves this order, so the README table reads top-to-bottom in the same
 * sequence everyone is used to (Lite → Pro → Pack → Brand → Spec).
 */
export const SLIDESTAGE_PRODUCTS: readonly SlideStageProduct[] =
  SLIDESTAGE_PRODUCTS_DATA as readonly SlideStageProduct[];

/** Convenience accessor — find a product by its slug. */
export function findSlideStageProduct(slug: string): SlideStageProduct | undefined {
  return SLIDESTAGE_PRODUCTS.find((product) => product.slug === slug);
}

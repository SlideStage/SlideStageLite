# @slidestage/brand

## 0.1.0

Initial extraction. Consolidates the SlideStage visual identity (Lite cyan,
Pro indigo, slidestage-pack amber) into a single workspace package.

- 23 SVG logo assets across three product surfaces (mark, wordmark,
  logo-stacked, logo-horizontal × 3 variants, favicon, social-card).
- 33 PNG rasterizations (1×, 2×, 3×, 8× depending on asset).
- 18 design tokens exported as TypeScript constants
  (`SLIDESTAGE_DESIGN_TOKENS`) with companion `dist/tokens.css` (CSS custom
  properties) and `dist/tokens.json` (flat key/value map) emitted at build
  time.
- Per-product subpaths (`./assets/lite`, `./assets/pro`, `./assets/pack`,
  `./tokens`) for bundler tree-shaking; raw asset paths reachable via
  `./assets/svg/*` and `./assets/png/*`.

Phase E5.b (next) will switch `rootwebsite`, `SlideStageLite`,
`SlideStagePro`, and `slidestage-pack` to consume from this package and
delete the duplicated brand directories.

Tracked in `SlideStageLite/docs/ECOSYSTEM_IMPROVEMENT_PLAN.md`, task E5.a.

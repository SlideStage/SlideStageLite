// Public aggregate entry for `@slidestage/brand`. Consumers are encouraged to
// import the narrower subpaths (`@slidestage/brand/tokens`,
// `@slidestage/brand/assets/lite`, etc.) so that bundlers can tree-shake the
// asset URL tables they do not use, but this barrel is provided so that quick
// integrations can grab everything via a single import:
//
//     import { LITE_BRAND_ASSETS, SLIDESTAGE_DESIGN_TOKENS } from '@slidestage/brand';

export * from './tokens.js';
export * from './assets/index.js';
export * from './products.js';

// Resolve packaged asset URLs relative to *this* compiled file. After tsup
// emits the package to `dist/assets/lite.js` (sibling layout of the source
// tree), the relative path `../../assets/...` correctly points at the static
// asset directory both in this monorepo and inside any consumer's
// `node_modules/@slidestage/brand/`.
const url = (relative: string): string =>
  new URL(`../../assets/${relative}`, import.meta.url).href;

/**
 * SlideStage Lite brand assets — generic SlideStage marks shared by the entire
 * ecosystem (the cyan logo lockup with no product suffix). Use these in
 * marketing surfaces that talk about SlideStage as a whole, or as the Lite
 * product mark when surfaces are scoped to the Lite app.
 */
export const LITE_BRAND_ASSETS = {
  markSvg: url('svg/slidestage-mark.svg'),
  markOnDarkSvg: url('svg/slidestage-mark-on-dark.svg'),
  wordmarkSvg: url('svg/slidestage-wordmark.svg'),
  logoStackedSvg: url('svg/slidestage-logo-stacked.svg'),
  logoHorizontalSvg: url('svg/slidestage-logo-horizontal.svg'),
  logoHorizontalOnDarkSvg: url('svg/slidestage-logo-horizontal-on-dark.svg'),
  logoHorizontalTaglineSvg: url('svg/slidestage-logo-horizontal-tagline.svg'),
  faviconSvg: url('svg/slidestage-favicon.svg'),
  socialCardSvg: url('svg/slidestage-social-card.svg'),

  markPng: url('png/slidestage-mark.png'),
  mark2xPng: url('png/slidestage-mark@2x.png'),
  markOnDarkPng: url('png/slidestage-mark-on-dark.png'),
  markOnDark2xPng: url('png/slidestage-mark-on-dark@2x.png'),
  wordmarkPng: url('png/slidestage-wordmark.png'),
  wordmark2xPng: url('png/slidestage-wordmark@2x.png'),
  logoStackedPng: url('png/slidestage-logo-stacked.png'),
  logoStacked2xPng: url('png/slidestage-logo-stacked@2x.png'),
  logoHorizontalPng: url('png/slidestage-logo-horizontal.png'),
  logoHorizontal2xPng: url('png/slidestage-logo-horizontal@2x.png'),
  logoHorizontalOnDarkPng: url('png/slidestage-logo-horizontal-on-dark.png'),
  logoHorizontalOnDark2xPng: url('png/slidestage-logo-horizontal-on-dark@2x.png'),
  logoHorizontalTaglinePng: url('png/slidestage-logo-horizontal-tagline.png'),
  logoHorizontalTagline2xPng: url('png/slidestage-logo-horizontal-tagline@2x.png'),
  faviconPng: url('png/slidestage-favicon.png'),
  favicon3xPng: url('png/slidestage-favicon@3x.png'),
  favicon8xPng: url('png/slidestage-favicon@8x.png'),
  socialCardPng: url('png/slidestage-social-card.png'),
} as const;

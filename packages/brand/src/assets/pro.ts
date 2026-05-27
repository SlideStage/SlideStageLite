const url = (relative: string): string =>
  new URL(`../../assets/${relative}`, import.meta.url).href;

/**
 * SlideStage Pro brand assets — indigo lockup used by the self-hosted
 * platform (multi-user library, notes/annotations, Docker-deployable).
 */
export const PRO_BRAND_ASSETS = {
  markSvg: url('svg/slidestage-pro-mark.svg'),
  markOnDarkSvg: url('svg/slidestage-pro-mark-on-dark.svg'),
  logoHorizontalSvg: url('svg/slidestage-pro-logo-horizontal.svg'),
  logoHorizontalOnDarkSvg: url('svg/slidestage-pro-logo-horizontal-on-dark.svg'),
  logoHorizontalTaglineSvg: url('svg/slidestage-pro-logo-horizontal-tagline.svg'),
  faviconSvg: url('svg/slidestage-pro-favicon.svg'),
  socialCardSvg: url('svg/slidestage-pro-social-card.svg'),

  markPng: url('png/slidestage-pro-mark.png'),
  mark2xPng: url('png/slidestage-pro-mark@2x.png'),
  logoHorizontalPng: url('png/slidestage-pro-logo-horizontal.png'),
  logoHorizontal2xPng: url('png/slidestage-pro-logo-horizontal@2x.png'),
  logoHorizontalOnDarkPng: url('png/slidestage-pro-logo-horizontal-on-dark.png'),
  logoHorizontalOnDark2xPng: url('png/slidestage-pro-logo-horizontal-on-dark@2x.png'),
  faviconPng: url('png/slidestage-pro-favicon.png'),
  favicon3xPng: url('png/slidestage-pro-favicon@3x.png'),
  favicon8xPng: url('png/slidestage-pro-favicon@8x.png'),
  socialCardPng: url('png/slidestage-pro-social-card.png'),
} as const;

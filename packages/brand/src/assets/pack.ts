const url = (relative: string): string =>
  new URL(`../../assets/${relative}`, import.meta.url).href;

/**
 * slidestage-pack brand assets — amber lockup used by the Agent Skill that
 * turns HTML decks into `.stage` files.
 */
export const PACK_BRAND_ASSETS = {
  markSvg: url('svg/slidestage-pack-mark.svg'),
  markOnDarkSvg: url('svg/slidestage-pack-mark-on-dark.svg'),
  logoHorizontalSvg: url('svg/slidestage-pack-logo-horizontal.svg'),
  logoHorizontalOnDarkSvg: url('svg/slidestage-pack-logo-horizontal-on-dark.svg'),
  logoHorizontalTaglineSvg: url('svg/slidestage-pack-logo-horizontal-tagline.svg'),
  faviconSvg: url('svg/slidestage-pack-favicon.svg'),
  socialCardSvg: url('svg/slidestage-pack-social-card.svg'),

  markPng: url('png/slidestage-pack-mark.png'),
  mark2xPng: url('png/slidestage-pack-mark@2x.png'),
  logoHorizontalPng: url('png/slidestage-pack-logo-horizontal.png'),
  logoHorizontal2xPng: url('png/slidestage-pack-logo-horizontal@2x.png'),
  socialCardPng: url('png/slidestage-pack-social-card.png'),
} as const;

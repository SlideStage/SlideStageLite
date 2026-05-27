// SlideStage shared design tokens.
//
// These tokens are the SoT — both `rootwebsite/src/styles/globals.css` and any
// future Lite/Pro app stylesheet should reference them instead of hard-coding
// hex values. The companion `dist/tokens.css` artifact (emitted by
// `scripts/build-tokens-css.mjs`) re-exports the same palette as CSS custom
// properties so that plain CSS / HTML consumers do not need a TS toolchain.
//
// Brand color palette (Lite cyan / Pro indigo / Pack amber) was extracted from
// the logo SVGs themselves so that surface tokens, accent tokens, and the brand
// hue stay in sync if the visual identity ever shifts.

export interface ColorToken {
  readonly cssVar: string;
  readonly hex: string;
  readonly description: string;
}

/** Brand hues used by per-product mark / wordmark assets. */
export const SLIDESTAGE_BRAND_COLORS = {
  liteCyan: {
    cssVar: '--ss-brand-lite',
    hex: '#06B6D4',
    description: 'SlideStage Lite primary brand hue (Tailwind cyan-500)',
  },
  proIndigo: {
    cssVar: '--ss-brand-pro',
    hex: '#4F46E5',
    description: 'SlideStage Pro primary brand hue (Tailwind indigo-600)',
  },
  packAmber: {
    cssVar: '--ss-brand-pack',
    hex: '#F59E0B',
    description: 'slidestage-pack primary brand hue (Tailwind amber-500)',
  },
} as const satisfies Record<string, ColorToken>;

/** Page / panel surface tokens — the dark theme that rootwebsite ships today. */
export const SLIDESTAGE_SURFACE_TOKENS = {
  bg: {
    cssVar: '--ss-color-bg',
    hex: '#0a0a0a',
    description: 'Base page background (deep ink)',
  },
  surface: {
    cssVar: '--ss-color-surface',
    hex: '#111111',
    description: 'Card / panel background',
  },
  surfaceHi: {
    cssVar: '--ss-color-surface-hi',
    hex: '#1a1a1a',
    description: 'Elevated card / hovered surface background',
  },
  border: {
    cssVar: '--ss-color-border',
    hex: '#27272a',
    description: 'Default border',
  },
  borderHi: {
    cssVar: '--ss-color-border-hi',
    hex: '#3f3f46',
    description: 'Hover / active border',
  },
} as const satisfies Record<string, ColorToken>;

/** Text tokens (against the dark surface palette). */
export const SLIDESTAGE_TEXT_TOKENS = {
  text: {
    cssVar: '--ss-color-text',
    hex: '#fafafa',
    description: 'Primary text on dark surface',
  },
  textMuted: {
    cssVar: '--ss-color-text-muted',
    hex: '#a1a1aa',
    description: 'Secondary text',
  },
  textDim: {
    cssVar: '--ss-color-text-dim',
    hex: '#71717a',
    description: 'Tertiary / hint text',
  },
} as const satisfies Record<string, ColorToken>;

/** Interactive tokens — CTA buttons, links, accents, warnings. */
export const SLIDESTAGE_ACCENT_TOKENS = {
  cta: {
    cssVar: '--ss-color-cta',
    hex: '#22c55e',
    description: 'Primary CTA fill (Tailwind green-500)',
  },
  ctaHover: {
    cssVar: '--ss-color-cta-hover',
    hex: '#16a34a',
    description: 'Primary CTA hover (Tailwind green-600)',
  },
  accent: {
    cssVar: '--ss-color-accent',
    hex: '#3b82f6',
    description: 'Interactive accent (Tailwind blue-500)',
  },
  accentHi: {
    cssVar: '--ss-color-accent-hi',
    hex: '#60a5fa',
    description: 'Accent hover (Tailwind blue-400)',
  },
  warn: {
    cssVar: '--ss-color-warn',
    hex: '#f59e0b',
    description: 'Warning state (Tailwind amber-500)',
  },
} as const satisfies Record<string, ColorToken>;

/** Convenience aggregate for tooling that wants to iterate every token. */
export const SLIDESTAGE_DESIGN_TOKENS = {
  ...SLIDESTAGE_BRAND_COLORS,
  ...SLIDESTAGE_SURFACE_TOKENS,
  ...SLIDESTAGE_TEXT_TOKENS,
  ...SLIDESTAGE_ACCENT_TOKENS,
} as const;

/** Map every CSS custom-property name to its hex value. */
export function toCssVarMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of Object.values(SLIDESTAGE_DESIGN_TOKENS)) {
    out[token.cssVar] = token.hex;
  }
  return out;
}

/** Render a `:root { ... }` CSS block declaring every token as a custom property. */
export function renderTokensCss(): string {
  const lines = Object.values(SLIDESTAGE_DESIGN_TOKENS).map(
    (t) => `  ${t.cssVar}: ${t.hex};`,
  );
  return `:root {\n${lines.join('\n')}\n}\n`;
}

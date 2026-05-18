/**
 * Sanity guard for the SlidesDeckLite ↔ SlidesDeckPro "twin" contract.
 *
 * The UI redesign (docs/UI_REDESIGN.md) pulled Lite's CSS variables, button
 * system, and major layout classes from Pro's globals.css. This test reads
 * the actual stylesheet on disk and asserts every Pro-derived token and
 * the layout anchors are still present. If somebody accidentally drops
 * `--primary` or renames `.btn.cta`, this test fails immediately instead
 * of waiting for the visual to look wrong in a Playwright run.
 *
 * Excluded from `tsconfig.app.json` (same pattern as
 * `src/converter/index.test.ts`) because the file imports node built-ins
 * that the app tsconfig deliberately does not expose.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(here, 'globals.css'), 'utf8');

const PRO_DERIVED_TOKENS = [
  ['--bg', '#0a0d12'],
  ['--bg-elev', '#12161d'],
  ['--bg-elev-2', '#1b2129'],
  ['--bg-elev-3', '#232c38'],
  ['--ink', '#f1f5f9'],
  ['--ink-muted', '#94a3b8'],
  ['--ink-strong', '#ffffff'],
  ['--primary', '#14b8a6'],
  ['--primary-strong', '#0d9488'],
  ['--cta', '#f97316'],
  ['--cta-strong', '#ea580c'],
  ['--accent', '#38bdf8'],
  ['--danger', '#ef4444'],
  ['--success', '#22c55e'],
  ['--radius', '10px'],
  ['--radius-lg', '14px'],
  ['--radius-xl', '20px'],
] as const;

const REQUIRED_BUTTON_CLASSES = [
  '.btn',
  '.btn.primary',
  '.btn.cta',
  '.btn.ghost',
  '.btn.ghost.danger',
  '.btn.icon-only',
  '.btn.small',
];

const REQUIRED_LAYOUT_ANCHORS = [
  '.app-shell',
  '.app-header',
  '.app-footer',
  '.landing-hero',
  '.landing-eyebrow',
  '.landing-benefits',
  '.benefit',
  '.converter-panel',
  '.converter-panel__drop',
  '.converter-step',
  '.trust-prompt',
  '.trust-prompt-eyebrow',
  '.trust-prompt-list',
  '.deck-counter',
  '.presenter-toolbar',
];

function escapeRegex(value: string): string {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

describe('design tokens (Lite ↔ Pro twin contract)', () => {
  it.each(PRO_DERIVED_TOKENS)('declares %s = %s', (token, value) => {
    const re = new RegExp(
      `${escapeRegex(token)}\\s*:\\s*${escapeRegex(value)}`,
      'i',
    );
    expect(CSS).toMatch(re);
  });

  it('uses Plus Jakarta Sans for --font-system', () => {
    expect(CSS).toMatch(/--font-system:\s*[\s\S]*?"Plus Jakarta Sans"/);
  });

  it('keeps color-scheme dark', () => {
    expect(CSS).toMatch(/color-scheme:\s*dark/);
  });

  it('respects prefers-reduced-motion globally', () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it.each(REQUIRED_BUTTON_CLASSES)('declares button variant %s', (cls) => {
    expect(CSS).toContain(cls);
  });

  it.each(REQUIRED_LAYOUT_ANCHORS)('declares layout anchor %s', (cls) => {
    expect(CSS).toContain(cls);
  });
});

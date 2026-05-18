/**
 * Footer behavioural tests.
 *
 * The Footer is driven entirely by VITE_BEIAN_* env variables read through
 * `import.meta.env`. Vitest's `vi.stubEnv` lets us patch those values per
 * test so we can verify every combination without rebuilding the bundle.
 *
 * We cover:
 *   1. Default (no env)      → only the "local · no server" status renders.
 *   2. ICP only              → status + ICP chip; no MPS chip, no logo.
 *   3. MPS with URL          → status + MPS chip; chip is a link with logo.
 *   4. MPS without URL       → status + MPS chip; chip degrades to a non-link.
 *   5. Both ICP + MPS + zh   → status + ICP + MPS, all in Chinese.
 *   6. ICP without URL       → uses the default MIIT portal href.
 *   7. Whitespace-only env   → treated as empty (chip not rendered).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nProvider } from '../i18n/I18nProvider';
import { Footer } from './Footer';

let container: HTMLDivElement;
let root: Root;

function render(locale: 'en' | 'zh-CN' = 'en'): void {
  act(() => {
    root.render(
      <I18nProvider initialLocale={locale}>
        <Footer />
      </I18nProvider>,
    );
  });
}

function q(testId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

/**
 * Force every Footer-related env to an empty string at the start of each
 * test. This makes the suite robust against a developer-local `.env` /
 * `.env.local` that Vite would otherwise inject through `import.meta.env`.
 * Tests that need a non-empty value override these with `vi.stubEnv` per
 * case; the afterEach reset wipes the override before the next test.
 */
function resetBeianEnv(): void {
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_BEIAN_ICP_TEXT', '');
  vi.stubEnv('VITE_BEIAN_ICP_URL', '');
  vi.stubEnv('VITE_BEIAN_MPS_TEXT', '');
  vi.stubEnv('VITE_BEIAN_MPS_URL', '');
}

beforeEach(() => {
  resetBeianEnv();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
});

describe('Footer (landing chrome)', () => {
  it('renders only the local-runtime status when no env is set', () => {
    render('en');
    expect(q('app-footer')).not.toBeNull();
    expect(q('app-footer-status')?.textContent).toMatch(/Runs locally/);
    expect(q('app-footer-icp')).toBeNull();
    expect(q('app-footer-mps')).toBeNull();
  });

  it('renders the ICP chip when VITE_BEIAN_ICP_TEXT is set', () => {
    vi.stubEnv('VITE_BEIAN_ICP_TEXT', '蜀ICP备2026001166号-1');
    vi.stubEnv('VITE_BEIAN_ICP_URL', 'https://beian.miit.gov.cn/');
    render('zh-CN');

    const icp = q('app-footer-icp');
    expect(icp).not.toBeNull();
    expect(icp?.tagName).toBe('A');
    expect(icp?.textContent).toBe('蜀ICP备2026001166号-1');
    expect(icp?.getAttribute('href')).toBe('https://beian.miit.gov.cn/');
    expect(icp?.getAttribute('target')).toBe('_blank');
    expect(icp?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(q('app-footer-mps')).toBeNull();
  });

  it('falls back to the default MIIT portal when only TEXT is set', () => {
    vi.stubEnv('VITE_BEIAN_ICP_TEXT', '京ICP备12345678号-1');
    render('en');

    const icp = q('app-footer-icp');
    expect(icp?.getAttribute('href')).toBe('https://beian.miit.gov.cn/');
  });

  it('renders the MPS chip as a link when both TEXT and URL are set', () => {
    vi.stubEnv('VITE_BEIAN_MPS_TEXT', '川公网安备51070402110341号');
    vi.stubEnv(
      'VITE_BEIAN_MPS_URL',
      'https://beian.mps.gov.cn/#/query/webSearch?code=51070402110341',
    );
    render('zh-CN');

    const mps = q('app-footer-mps');
    expect(mps).not.toBeNull();
    expect(mps?.tagName).toBe('A');
    expect(mps?.getAttribute('href')).toBe(
      'https://beian.mps.gov.cn/#/query/webSearch?code=51070402110341',
    );
    expect(mps?.textContent).toContain('川公网安备51070402110341号');
    expect(mps?.querySelector('img')?.getAttribute('src')).toBe('/mpslogo.png');
  });

  it('degrades MPS chip to plain text when URL is missing but TEXT is set', () => {
    vi.stubEnv('VITE_BEIAN_MPS_TEXT', '京公网安备11000000000001号');
    render('en');

    const mps = q('app-footer-mps');
    expect(mps).not.toBeNull();
    expect(mps?.tagName).toBe('SPAN');
    expect(mps?.getAttribute('href')).toBeNull();
    expect(mps?.textContent).toContain('京公网安备11000000000001号');
    expect(mps?.querySelector('img')?.getAttribute('src')).toBe('/mpslogo.png');
  });

  it('renders ICP + MPS together with Chinese copy', () => {
    vi.stubEnv('VITE_BEIAN_ICP_TEXT', '蜀ICP备2026001166号-1');
    vi.stubEnv('VITE_BEIAN_ICP_URL', 'https://beian.miit.gov.cn/');
    vi.stubEnv('VITE_BEIAN_MPS_TEXT', '川公网安备51070402110341号');
    vi.stubEnv(
      'VITE_BEIAN_MPS_URL',
      'https://beian.mps.gov.cn/#/query/webSearch?code=51070402110341',
    );
    render('zh-CN');

    expect(q('app-footer-status')?.textContent).toMatch(/本地运行/);
    expect(q('app-footer-icp')).not.toBeNull();
    expect(q('app-footer-mps')).not.toBeNull();
  });

  it('treats whitespace-only env values as empty', () => {
    vi.stubEnv('VITE_BEIAN_ICP_TEXT', '   ');
    vi.stubEnv('VITE_BEIAN_MPS_TEXT', '\t\n');
    render('en');

    expect(q('app-footer-icp')).toBeNull();
    expect(q('app-footer-mps')).toBeNull();
  });
});

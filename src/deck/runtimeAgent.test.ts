import { describe, expect, it } from 'vitest';
import {
  STAGE_RUNTIME_AGENT_SOURCE,
  injectRuntimeAgent,
} from '@slidestage/core/deck/runtimeAgent';

describe('injectRuntimeAgent', () => {
  it('injects the agent just before </body>', () => {
    const html = '<html><body><h1>Slide</h1></body></html>';
    const out = injectRuntimeAgent(html);
    expect(out).toContain('data-slidestage-agent="1"');
    expect(out.indexOf('data-slidestage-agent')).toBeLessThan(out.indexOf('</body>'));
    // Author content is preserved untouched.
    expect(out).toContain('<h1>Slide</h1>');
  });

  it('matches a </body > with whitespace and injects before the close', () => {
    const out = injectRuntimeAgent('<body>x</body >');
    expect(out).toContain('data-slidestage-agent="1"');
    // The agent lands before the (normalized) body close, content intact.
    expect(out.indexOf('data-slidestage-agent')).toBeLessThan(out.indexOf('</body>'));
    expect(out).toContain('<body>x<script');
  });

  it('appends the agent when there is no body close tag', () => {
    const out = injectRuntimeAgent('<div>fragment</div>');
    expect(out.startsWith('<div>fragment</div>')).toBe(true);
    expect(out).toContain('data-slidestage-agent="1"');
  });

  it('is idempotent — never double-injects', () => {
    const once = injectRuntimeAgent('<body>x</body>');
    const twice = injectRuntimeAgent(once);
    expect(twice).toBe(once);
    const matches = twice.split('data-slidestage-agent="1"').length - 1;
    expect(matches).toBe(1);
  });

  it('leaves empty input untouched', () => {
    expect(injectRuntimeAgent('')).toBe('');
  });

  it('embeds the guard flag so re-injection is detectable', () => {
    expect(STAGE_RUNTIME_AGENT_SOURCE).toContain('window.__slidestageAgent');
  });

  it('avoids tokens that would break <script> embedding', () => {
    // No closing script tag, no template-literal interpolation that a
    // bundler/HTML parser could choke on.
    expect(STAGE_RUNTIME_AGENT_SOURCE).not.toContain('</script');
    expect(STAGE_RUNTIME_AGENT_SOURCE).not.toContain('${');
  });

  it('never emits a "data:" substring (would trip published-HTML scanners)', () => {
    // loadDeck publishes this agent inside SW-served slide HTML; that
    // HTML is asserted elsewhere to contain no leftover data: URLs, so
    // the agent must not introduce the substring via object literals.
    expect(STAGE_RUNTIME_AGENT_SOURCE).not.toMatch(/data:/);
    expect(injectRuntimeAgent('<body>x</body>')).not.toMatch(/data:/);
  });

  it('carries the edit-mode protocol handlers', () => {
    // Wire-level contract markers for the text-edit feature: the host
    // sends `edit-mode`, the agent posts `edit` payloads with the
    // structural selector fields validated by parseSlideEdit.
    expect(STAGE_RUNTIME_AGENT_SOURCE).toContain("case 'edit-mode':");
    expect(STAGE_RUNTIME_AGENT_SOURCE).toContain("type: 'edit'");
    expect(STAGE_RUNTIME_AGENT_SOURCE).toContain(':nth-of-type(');
    // The edit selector generator must emit body-rooted paths.
    expect(STAGE_RUNTIME_AGENT_SOURCE).toContain("'body>' + parts.join('>')");
  });

  it('carries the mixed-content text-run editing machinery', () => {
    // Direct text runs of mixed elements (e.g. multi-font headings) are
    // resolved via the caret-from-point APIs, edited inside a temporary
    // wrapper span, and reported with a textNode index.
    expect(STAGE_RUNTIME_AGENT_SOURCE).toContain('caretPositionFromPoint');
    expect(STAGE_RUNTIME_AGENT_SOURCE).toContain('caretRangeFromPoint');
    expect(STAGE_RUNTIME_AGENT_SOURCE).toContain('data-slidestage-editwrap');
    expect(STAGE_RUNTIME_AGENT_SOURCE).toContain('textNode: runIndex');
  });
});

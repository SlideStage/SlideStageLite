// In-iframe runtime agent injected into every slide HTML at load time.
//
// Why this exists: a `.stage` deck renders inside a sandboxed iframe
// (`allow-scripts`, opaque origin). The host shell and the audience
// window each render their OWN independent iframe of the same slide and,
// before this agent, had no channel into that iframe. So anything that
// happened *inside* a slide — reveal.js fragments, impress.js steps,
// build animations, click-driven interactions — only advanced in the
// presenter's iframe and was invisible to the audience.
//
// The agent is a tiny postMessage bridge that runs INSIDE each slide. It
// works under `allow-scripts` only (postMessage does not need
// `allow-same-origin`). The host injects it; the author's HTML never has
// to know about it.
//
// Three responsibilities:
//   1. Step sync (Strategy A) — detect a "stepping" model for the slide
//      (custom `window.SlideStage` hook > reveal.js > impress.js >
//      generic `.fragment`), report its state to the host, and drive it
//      on command. State (not raw events) crosses the wire, so the
//      animation plays natively and identically on both screens.
//   2. Best-effort passthrough (Strategy A+) — when NO stepping model is
//      detected, forward click + scroll from the presenter iframe and
//      replay them in the audience iframe.
//   3. Selection mirroring — on the presenter, watch `selectionchange`
//      and forward the bounding rects of the highlighted text so the
//      audience window can paint an identical selection highlight. Rects
//      (not a DOM range) cross the wire; the audience draws them on an
//      overlay, immune to cross-iframe DOM drift.
//
// The message shapes here MUST stay in sync with the validators in
// `@slidestage/ui/presenter/slideRuntime` (the host side). Both ends are
// hand-written because this side ships as a string, not as imported TS.

/**
 * Self-contained IIFE source for the in-iframe agent. Injected verbatim
 * inside a `<script>` tag. Authored without template literals / `${}` /
 * `</script>` so it survives string embedding untouched.
 */
export const STAGE_RUNTIME_AGENT_SOURCE = `(function () {
  if (window.__slidestageAgent) return;
  window.__slidestageAgent = true;

  var HOST = 'slidestage-host';
  var AGENT = 'slidestage-agent';

  var role = null;            // 'presenter' | 'audience'
  var forwardEvents = false;
  var driver = null;          // active step driver, or null
  var passthrough = false;    // A+ fallback engaged (no driver found)
  var pendingRuntime = null;  // audience: goto received before driver ready
  var lastSentJSON = '';
  var scrollScheduled = false;
  var pollTimer = 0;
  var selectionBound = false; // presenter: selectionchange listener attached
  var lastSelJSON = '';       // presenter: dedupe identical selection reports
  var selScheduled = false;   // presenter: rAF coalescing for selectionchange

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }

  // Build a SlideRuntimeState. The 'data' key is assigned via bracket
  // notation on purpose so this agent source never contains the literal
  // substring "data" + colon — tooling that scans published slide HTML
  // for leftover inlined data URIs must not trip over our object literals.
  function mk(drv, index, count, canPrev, canNext, payload) {
    var o = { driver: drv, index: index, count: count, canPrev: canPrev, canNext: canNext };
    o['data'] = payload === undefined ? null : payload;
    return o;
  }

  function post(msg) {
    try {
      msg.source = AGENT;
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(msg, '*');
      }
    } catch (e) { /* ignore */ }
  }

  // Flatten a framework state object into a small record of primitives
  // (the host re-validates this before applying it).
  function flat(obj) {
    var out = {};
    if (!obj || typeof obj !== 'object') return out;
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length && i < 32; i++) {
      var k = keys[i];
      var v = obj[k];
      if (v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
        out[k] = v;
      }
    }
    return out;
  }

  // ---------------- drivers ----------------

  function detectCustom() {
    var S = window.SlideStage;
    if (!S || typeof S.goToStep !== 'function' || typeof S.getSteps !== 'function') return null;
    function cur() { try { return num(typeof S.getStep === 'function' ? S.getStep() : 0); } catch (e) { return 0; } }
    function cnt() { try { return num(S.getSteps()); } catch (e) { return 0; } }
    return {
      read: function () {
        var i = cur(), c = cnt();
        return mk('custom', i, c, i > 0, i < c, null);
      },
      next: function () { try { S.goToStep(cur() + 1); } catch (e) {} },
      prev: function () { try { S.goToStep(cur() - 1); } catch (e) {} },
      apply: function (rt) { try { S.goToStep(rt && typeof rt.index === 'number' ? rt.index : 0); } catch (e) {} },
      bind: function (cb) { try { if (typeof S.onChange === 'function') S.onChange(cb); } catch (e) {} }
    };
  }

  function detectReveal() {
    var R = window.Reveal;
    if (!R || typeof R.getState !== 'function') return null;
    function avail() {
      var f = { prev: false, next: false };
      var r = { left: false, right: false, up: false, down: false };
      try { if (R.availableFragments) f = R.availableFragments() || f; } catch (e) {}
      try { if (R.availableRoutes) r = R.availableRoutes() || r; } catch (e) {}
      return { f: f, r: r };
    }
    return {
      read: function () {
        var a = avail();
        var state = {}; try { state = R.getState() || {}; } catch (e) {}
        var idx = {}; try { idx = R.getIndices ? R.getIndices() : {}; } catch (e) {}
        var count = 0; try { count = R.getTotalSlides ? R.getTotalSlides() : 0; } catch (e) {}
        return mk(
          'reveal',
          num(idx.h),
          num(count),
          !!(a.f.prev || a.r.left || a.r.up),
          !!(a.f.next || a.r.right || a.r.down),
          flat(state)
        );
      },
      next: function () { try { R.next(); } catch (e) {} },
      prev: function () { try { R.prev(); } catch (e) {} },
      apply: function (rt) { try { if (rt && rt.data) R.setState(rt.data); } catch (e) {} },
      bind: function (cb) {
        try {
          R.on('ready', cb);
          R.on('slidechanged', cb);
          R.on('fragmentshown', cb);
          R.on('fragmenthidden', cb);
          R.on('overviewshown', cb);
          R.on('overviewhidden', cb);
        } catch (e) {}
      }
    };
  }

  function impressSteps() {
    try { return Array.prototype.slice.call(document.querySelectorAll('.step')); } catch (e) { return []; }
  }

  function detectImpress() {
    if (typeof window.impress !== 'function') return null;
    var api; try { api = window.impress(); } catch (e) { return null; }
    if (!api || typeof api.goto !== 'function') return null;
    function curIndex() {
      var all = impressSteps();
      var active = null;
      try { active = document.querySelector('.step.active'); } catch (e) {}
      var i = active ? all.indexOf(active) : -1;
      return i < 0 ? 0 : i;
    }
    return {
      read: function () {
        var all = impressSteps();
        var i = curIndex();
        return mk('impress', i, all.length, i > 0, i < all.length - 1, { index: i });
      },
      next: function () { try { api.next(); } catch (e) {} },
      prev: function () { try { api.prev(); } catch (e) {} },
      apply: function (rt) {
        try {
          var i = rt && rt.data && typeof rt.data.index === 'number' ? rt.data.index : (rt && typeof rt.index === 'number' ? rt.index : 0);
          api.goto(i);
        } catch (e) {}
      },
      bind: function (cb) { try { document.addEventListener('impress:stepenter', cb, true); } catch (e) {} }
    };
  }

  // Reveal-style static fragments. Restricted to '.fragment' on purpose:
  // it is an unambiguous, CSS-driven convention (the split converter keeps
  // reveal's '.fragment.visible' styling), so toggling 'visible' is safe.
  // Custom step engines should expose window.SlideStage instead.
  function fragmentEls() {
    var nodes = [];
    try { nodes = Array.prototype.slice.call(document.querySelectorAll('.fragment')); } catch (e) {}
    nodes.sort(function (a, b) {
      function ord(el) {
        var d = el.getAttribute ? el.getAttribute('data-fragment-index') : null;
        var n = parseFloat(d);
        return isNaN(n) ? null : n;
      }
      var oa = ord(a), ob = ord(b);
      if (oa === null && ob === null) return 0;
      if (oa === null) return 1;
      if (ob === null) return -1;
      return oa - ob;
    });
    return nodes;
  }

  function detectGeneric() {
    if (fragmentEls().length === 0) return null;
    var current = 0;
    try {
      var els0 = fragmentEls();
      var vis = 0;
      for (var i = 0; i < els0.length; i++) { if (els0[i].classList.contains('visible')) vis++; }
      current = vis;
    } catch (e) {}
    function applyN(n) {
      var els = fragmentEls();
      n = Math.max(0, Math.min(els.length, n));
      for (var i = 0; i < els.length; i++) {
        if (i < n) { els[i].classList.add('visible'); }
        else { els[i].classList.remove('visible'); }
      }
      current = n;
    }
    return {
      read: function () {
        var c = fragmentEls().length;
        if (current > c) current = c;
        return mk('generic', current, c, current > 0, current < c, null);
      },
      next: function () { applyN(current + 1); },
      prev: function () { applyN(current - 1); },
      apply: function (rt) { applyN(rt && typeof rt.index === 'number' ? rt.index : 0); },
      bind: function () { /* generic state only changes via our own commands */ }
    };
  }

  function detect() {
    return detectCustom() || detectReveal() || detectImpress() || detectGeneric();
  }

  // ---------------- reporting (presenter) ----------------

  function report() {
    if (!driver || role !== 'presenter') return;
    var rt; try { rt = driver.read(); } catch (e) { return; }
    var j;
    try { j = JSON.stringify(rt); } catch (e) { j = ''; }
    if (j && j === lastSentJSON) return;
    lastSentJSON = j;
    post({ type: 'runtime', runtime: rt });
  }

  function attachDriver(d) {
    driver = d;
    if (role === 'presenter') {
      try { d.bind(report); } catch (e) {}
      report();
    } else if (pendingRuntime) {
      try { d.apply(pendingRuntime); } catch (e) {}
      pendingRuntime = null;
    }
  }

  // ---------------- passthrough (A+) ----------------

  function enablePassthrough() {
    if (passthrough || driver) return;
    passthrough = true;
    if (role !== 'presenter' || !forwardEvents) return;
    try {
      document.addEventListener('click', function (e) {
        post({ type: 'input', event: { kind: 'click', x: num(e.clientX), y: num(e.clientY) } });
      }, true);
      window.addEventListener('scroll', function () {
        if (scrollScheduled) return;
        scrollScheduled = true;
        var raf = window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); };
        raf(function () {
          scrollScheduled = false;
          var se = document.scrollingElement || document.documentElement;
          post({ type: 'input', event: { kind: 'scroll', sx: num(se && se.scrollLeft), sy: num(se && se.scrollTop) } });
        });
      }, true);
    } catch (e) {}
  }

  function applyReplay(ev) {
    if (!ev) return;
    try {
      if (ev.kind === 'click') {
        var el = document.elementFromPoint(num(ev.x), num(ev.y));
        if (el) {
          var fired = false;
          try {
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: num(ev.x), clientY: num(ev.y) }));
            fired = true;
          } catch (e2) {}
          if (!fired && typeof el.click === 'function') el.click();
        }
      } else if (ev.kind === 'scroll') {
        var se = document.scrollingElement || document.documentElement;
        if (se) {
          if (typeof se.scrollTo === 'function') se.scrollTo(num(ev.sx), num(ev.sy));
          else { se.scrollLeft = num(ev.sx); se.scrollTop = num(ev.sy); }
        }
      }
    } catch (e) {}
  }

  // ---------------- text selection (presenter) ----------------

  // Collect the bounding rects of the current selection in iframe viewport
  // (CSS px) coordinates. The slide iframe's viewport equals the deck's
  // logical dimensions, so these map 1:1 onto the audience overlay. An
  // empty array is a valid result and means "no selection / cleared".
  function selectionRects() {
    var out = [];
    try {
      var sel = window.getSelection ? window.getSelection() : null;
      if (!sel || sel.isCollapsed || !sel.rangeCount) return out;
      for (var r = 0; r < sel.rangeCount; r++) {
        var rng = sel.getRangeAt(r);
        var list = rng && rng.getClientRects ? rng.getClientRects() : null;
        if (!list) continue;
        for (var i = 0; i < list.length; i++) {
          var rc = list[i];
          if (!rc || rc.width <= 0 || rc.height <= 0) continue;
          out.push({ x: Math.round(num(rc.left)), y: Math.round(num(rc.top)), w: Math.round(num(rc.width)), h: Math.round(num(rc.height)) });
          if (out.length >= 200) return out;
        }
      }
    } catch (e) {}
    return out;
  }

  function reportSelection() {
    if (role !== 'presenter') return;
    var rects = selectionRects();
    var j;
    try { j = JSON.stringify(rects); } catch (e) { j = ''; }
    if (j === lastSelJSON) return;
    lastSelJSON = j;
    post({ type: 'selection', rects: rects });
  }

  function scheduleSelection() {
    if (selScheduled) return;
    selScheduled = true;
    var raf = window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); };
    raf(function () { selScheduled = false; reportSelection(); });
  }

  function enableSelectionCapture() {
    if (selectionBound || role !== 'presenter') return;
    selectionBound = true;
    try { document.addEventListener('selectionchange', scheduleSelection, true); } catch (e) {}
    scheduleSelection();
  }

  // ---------------- init / driver discovery ----------------

  function startDiscovery() {
    var found = detect();
    if (found) { attachDriver(found); return; }
    // Frameworks may initialize asynchronously; poll briefly before
    // committing to the passthrough fallback.
    var attempts = 0;
    if (pollTimer) { try { clearInterval(pollTimer); } catch (e) {} }
    pollTimer = setInterval(function () {
      attempts++;
      var d = detect();
      if (d) { try { clearInterval(pollTimer); } catch (e) {} pollTimer = 0; attachDriver(d); return; }
      if (attempts >= 12) { try { clearInterval(pollTimer); } catch (e) {} pollTimer = 0; enablePassthrough(); }
    }, 100);
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object' || d.source !== HOST) return;
    // Only accept commands from the host (our parent) window.
    if (e.source && e.source !== window.parent) return;
    switch (d.type) {
      case 'init':
        role = d.role === 'audience' ? 'audience' : 'presenter';
        forwardEvents = !!d.forwardEvents;
        startDiscovery();
        enableSelectionCapture();
        break;
      case 'step':
        if (driver) {
          if (d.action === 'prev') driver.prev(); else driver.next();
          report();
        }
        break;
      case 'goto':
        if (role === 'audience') {
          if (driver) { try { driver.apply(d.runtime); } catch (e2) {} }
          else { pendingRuntime = d.runtime; }
        }
        break;
      case 'replay':
        if (role === 'audience') applyReplay(d.event);
        break;
      case 'ping':
        post({ type: 'ready' });
        break;
      default:
        break;
    }
  }, false);

  // Announce readiness so the host replies with an 'init'. Posted now and
  // again on DOM ready in case the host attaches its listener late.
  post({ type: 'ready' });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { post({ type: 'ready' }); }, { once: true });
  }
})();`;

const BODY_CLOSE_RE = /<\/body\s*>/i;

/**
 * Inject the runtime agent into a slide's HTML. Inserted just before
 * `</body>` (so framework globals like `Reveal`/`impress` are already
 * defined) or appended when there is no body close tag.
 *
 * Runs at load time on the rewritten HTML, so the `.stage` archive bytes
 * — and therefore the deck fingerprint and all per-deck persistence —
 * stay untouched.
 */
export function injectRuntimeAgent(html: string): string {
  if (typeof html !== 'string' || html.length === 0) return html;
  if (html.indexOf('window.__slidestageAgent') !== -1) return html;
  const tag = `<script data-slidestage-agent="1">${STAGE_RUNTIME_AGENT_SOURCE}</script>`;
  if (BODY_CLOSE_RE.test(html)) {
    return html.replace(BODY_CLOSE_RE, `${tag}</body>`);
  }
  return html + tag;
}

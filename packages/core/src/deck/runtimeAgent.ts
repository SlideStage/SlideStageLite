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
//   4. Edit mode (presenter only, host-toggled) — clicking a pure-text
//      leaf element turns it contentEditable; commit on blur/Enter,
//      cancel on Escape. Each commit posts an `edit` message carrying a
//      structural selector (`body>tag:nth-of-type(n)>...`) plus the
//      before/after TEXT (never HTML). The host persists these as
//      patches and re-applies them at load time via
//      `applySlidePatchesToHtml`.
//
//      Mixed-content elements (e.g. `<h1>投资组合<span>实证分析</span></h1>`)
//      are handled per text run: the click is resolved to the direct
//      text node under the pointer via caretPositionFromPoint /
//      caretRangeFromPoint, that node is temporarily wrapped in a
//      contentEditable span, and the commit posts the patch with a
//      `textNode` index so only that run is rewritten — sibling
//      elements (differently-styled runs) stay untouched. Emptying a
//      run entirely is treated as cancel: an empty text node would
//      vanish on the next serialize → reparse and shift the indices of
//      every later patch on the same element.
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
  var editMode = false;       // presenter: host-toggled text edit mode
  var editBound = false;      // presenter: edit listeners attached
  var editEl = null;          // element currently contentEditable (leaf, or run wrapper)
  var editPrevText = '';      // its text when editing began
  var editPrevOutline = '';   // its inline outline when editing began
  var editRunParent = null;   // text-run edit: the mixed-content container
  var editRunIndex = -1;      // text-run edit: index among the container's direct text nodes
  var hoverEl = null;         // edit mode: currently outlined hover target
  var hoverPrevOutline = '';

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
        // Edit-mode clicks select an element to edit; mirroring them to
        // the audience would replay a meaningless interaction there.
        if (editMode) return;
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

  // ---------------- text edit mode (presenter) ----------------

  // Tags that never take part in text editing, as leaf or run container.
  function deniedEditTag(tag) {
    return tag === 'html' || tag === 'body' || tag === 'head' || tag === 'script' ||
        tag === 'style' || tag === 'svg' || tag === 'iframe' || tag === 'canvas' ||
        tag === 'video' || tag === 'audio' || tag === 'img' || tag === 'input' ||
        tag === 'textarea' || tag === 'select' || tag === 'br' || tag === 'hr';
  }

  // An element qualifies for in-place editing when it is a "pure text
  // leaf": no element children, at least one non-whitespace text node.
  // Editing assigns textContent only, so structure cannot be damaged.
  function isEditableLeaf(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName ? String(el.tagName).toLowerCase() : '';
    if (!tag || deniedEditTag(tag)) return false;
    var kids = el.childNodes;
    var hasText = false;
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (n.nodeType === 1) return false;
      if (n.nodeType === 3 && /\\S/.test(n.nodeValue || '')) hasText = true;
    }
    return hasText;
  }

  // A mixed-content element whose direct text runs may be edited one at
  // a time: not denied, has BOTH element children and at least one
  // non-whitespace direct text node. (Pure-text leaves take the simpler
  // whole-element path above.)
  function isRunContainer(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName ? String(el.tagName).toLowerCase() : '';
    if (!tag || deniedEditTag(tag)) return false;
    var kids = el.childNodes;
    var hasText = false;
    var hasEl = false;
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (n.nodeType === 1) hasEl = true;
      if (n.nodeType === 3 && /\\S/.test(n.nodeValue || '')) hasText = true;
    }
    return hasEl && hasText;
  }

  // Text node under a viewport point. caretPositionFromPoint is the
  // standard API; WebKit (Tauri's WKWebView) ships the older
  // caretRangeFromPoint, so try both.
  function caretNodeAt(x, y) {
    try {
      if (document.caretPositionFromPoint) {
        var p = document.caretPositionFromPoint(x, y);
        if (p) return p.offsetNode || null;
      }
    } catch (e) {}
    try {
      if (document.caretRangeFromPoint) {
        var r = document.caretRangeFromPoint(x, y);
        if (r) return r.startContainer || null;
      }
    } catch (e2) {}
    return null;
  }

  // Index of node among the direct text-node children of parent
  // (whitespace-only nodes included — parity with the host's patch
  // application, which counts the same way on the static HTML).
  function textRunIndex(parent, node) {
    var kids = parent.childNodes;
    var idx = 0;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k === node) return k.nodeType === 3 ? idx : -1;
      if (k.nodeType === 3) idx++;
    }
    return -1;
  }

  // Resolve a click on/inside a mixed-content element to the direct
  // text-node run under the pointer. Returns { parent, node } or null.
  function findEditableRun(target, x, y) {
    var n = caretNodeAt(x, y);
    if (!n || n.nodeType !== 3) return null;
    if (!/\\S/.test(n.nodeValue || '')) return null;
    var p = n.parentElement;
    if (!p || !isRunContainer(p)) return null;
    // The caret may snap to text outside the clicked element (padding /
    // whitespace clicks). Accept the hit only when it stays inside the
    // click target, or the target is an ancestor of the run's parent.
    if (target && target.nodeType === 1 && target !== p && !target.contains(p)) return null;
    return { parent: p, node: n };
  }

  function findEditable(start) {
    var el = start;
    var hops = 0;
    while (el && hops < 4) {
      if (isEditableLeaf(el)) return el;
      el = el.parentElement;
      hops++;
    }
    return null;
  }

  // Structural selector from body down to the element:
  // body>tag:nth-of-type(i)>... Matches SLIDE_PATCH_SELECTOR_RE on the
  // host side; anything fancier is rejected there.
  function selectorFor(el) {
    var parts = [];
    var cur = el;
    while (cur && cur.tagName && String(cur.tagName).toLowerCase() !== 'body' && cur.parentElement) {
      var tag = String(cur.tagName).toLowerCase();
      if (!/^[a-z][a-z0-9-]*$/.test(tag)) return '';
      var idx = 1;
      var sib = cur;
      while ((sib = sib.previousElementSibling)) {
        if (sib.tagName && String(sib.tagName).toLowerCase() === tag) idx++;
      }
      parts.unshift(tag + ':nth-of-type(' + idx + ')');
      cur = cur.parentElement;
    }
    if (!cur || !cur.tagName || String(cur.tagName).toLowerCase() !== 'body') return '';
    return parts.length ? 'body>' + parts.join('>') : '';
  }

  function clearEditHover() {
    if (!hoverEl) return;
    try { hoverEl.style.outline = hoverPrevOutline; } catch (e) {}
    hoverEl = null;
    hoverPrevOutline = '';
  }

  function textOf(el) {
    var t = '';
    try { t = el.textContent == null ? '' : String(el.textContent); } catch (e) {}
    return t;
  }

  // End the current edit. cancel=true restores the original text and
  // reports nothing; otherwise a changed text is posted to the host.
  function commitEdit(cancel) {
    var el = editEl;
    if (!el) return;
    var runParent = editRunParent;
    var runIndex = editRunIndex;
    editEl = null;
    editRunParent = null;
    editRunIndex = -1;
    var before = editPrevText;
    editPrevText = '';
    var prevOutline = editPrevOutline;
    editPrevOutline = '';
    if (runParent) {
      // Text-run edit: unwrap the temporary span, leaving exactly one
      // text node at the original position. An emptied run is restored
      // (see the header comment — empty text nodes break run indices).
      var runAfter = textOf(el);
      var keep = cancel || runAfter === '' ? before : runAfter;
      try {
        runParent.insertBefore(document.createTextNode(keep), el);
        runParent.removeChild(el);
      } catch (e) { return; }
      if (keep === before) return;
      if (before.length > 10000 || runAfter.length > 10000) return;
      var runSel = selectorFor(runParent);
      if (!runSel || runSel.length > 1000 || runIndex < 0) return;
      post({ type: 'edit', edit: { selector: runSel, before: before, after: runAfter, textNode: runIndex } });
      return;
    }
    try { el.removeAttribute('contenteditable'); } catch (e) {}
    try { el.style.outline = prevOutline; } catch (e) {}
    if (cancel) {
      try { el.textContent = before; } catch (e) {}
      return;
    }
    var after = textOf(el);
    if (after === before) return;
    if (before.length > 10000 || after.length > 10000) {
      try { el.textContent = before; } catch (e) {}
      return;
    }
    var sel = selectorFor(el);
    if (!sel || sel.length > 1000) {
      try { el.textContent = before; } catch (e) {}
      return;
    }
    post({ type: 'edit', edit: { selector: sel, before: before, after: after } });
  }

  function focusEditable(el) {
    var applied = false;
    try { el.contentEditable = 'plaintext-only'; applied = el.isContentEditable === true; } catch (e) {}
    if (!applied) {
      try { el.setAttribute('contenteditable', 'true'); } catch (e) {}
    }
    try { el.style.outline = '2px dashed rgba(56, 189, 173, 0.95)'; } catch (e) {}
    try { el.focus(); } catch (e) {}
  }

  function beginEdit(el) {
    if (editEl === el) return;
    commitEdit(false);
    if (hoverEl === el) clearEditHover();
    editEl = el;
    editPrevText = textOf(el);
    editPrevOutline = el.style ? (el.style.outline || '') : '';
    focusEditable(el);
  }

  // Begin editing one direct text run of a mixed-content element by
  // wrapping the text node in a temporary contentEditable span. The
  // wrapper never survives the edit (commitEdit unwraps it), so the
  // recorded patch stays pure text keyed by the parent's selector plus
  // the run index.
  function beginTextRunEdit(parent, node) {
    commitEdit(false);
    if (hoverEl === parent) clearEditHover();
    var idx = textRunIndex(parent, node);
    if (idx < 0) return;
    var sel = selectorFor(parent);
    if (!sel || sel.length > 1000) return;
    var wrap = document.createElement('span');
    wrap.setAttribute('data-slidestage-editwrap', '1');
    try {
      parent.insertBefore(wrap, node);
      wrap.appendChild(node);
    } catch (e) { return; }
    editEl = wrap;
    editRunParent = parent;
    editRunIndex = idx;
    editPrevText = textOf(wrap);
    editPrevOutline = '';
    focusEditable(wrap);
  }

  function setEditMode(on) {
    if (role !== 'presenter') return;
    var want = !!on;
    if (editMode === want) return;
    if (!want) {
      commitEdit(false);
      clearEditHover();
    }
    editMode = want;
    if (want) bindEditListeners();
  }

  function bindEditListeners() {
    if (editBound) return;
    editBound = true;
    try {
      document.addEventListener('click', function (e) {
        if (!editMode) return;
        var t = findEditable(e.target);
        if (t) {
          e.preventDefault();
          e.stopPropagation();
          beginEdit(t);
          return;
        }
        var run = findEditableRun(e.target, num(e.clientX), num(e.clientY));
        if (!run) return;
        e.preventDefault();
        e.stopPropagation();
        beginTextRunEdit(run.parent, run.node);
      }, true);
      document.addEventListener('mouseover', function (e) {
        if (!editMode) return;
        var t = findEditable(e.target);
        if (!t && e.target && e.target.nodeType === 1 && isRunContainer(e.target)) {
          t = e.target;
        }
        if (t === hoverEl) return;
        clearEditHover();
        if (t && t !== editEl) {
          hoverEl = t;
          hoverPrevOutline = t.style ? (t.style.outline || '') : '';
          try { t.style.outline = '1px dashed rgba(56, 189, 173, 0.6)'; } catch (e2) {}
        }
      }, true);
      document.addEventListener('focusout', function (e) {
        if (!editMode || !editEl) return;
        if (e.target === editEl) commitEdit(false);
      }, true);
      document.addEventListener('keydown', function (e) {
        if (!editMode || !editEl) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          commitEdit(true);
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          var el = editEl;
          try { el.blur(); } catch (e2) { commitEdit(false); }
        }
      }, true);
    } catch (e) {}
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
        setEditMode(!!d.editMode);
        break;
      case 'edit-mode':
        setEditMode(!!d.enabled);
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

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';

const tokensCss = `
    :root { color-scheme: light; font-family: Inter, system-ui, sans-serif; }
    body { margin: 0; background: #f8fafc; color: #172033; }
    .slide { display: grid; min-height: 100vh; place-items: center; text-align: center; }
    h1 { font-size: 96px; margin: 0; }
    p { font-size: 36px; }
  `;

function buildSlideHtml(title, body) {
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <link rel="stylesheet" href="../shared/tokens.css" />
      </head>
      <body>
        <main class="slide">
          <div>
            <h1>${title}</h1>
            <p>${body}</p>
          </div>
        </main>
      </body>
    </html>
  `;
}

async function emit(zipName, files) {
  const bytes = zipSync(files, { level: 9 });
  const outPaths = [resolve(`tests/fixtures/${zipName}`), resolve(`public/fixtures/${zipName}`)];
  for (const outPath of outPaths) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, bytes);
    console.log(`Wrote ${outPath}`);
  }
}

async function emitSource(name, bytes) {
  // Converter source fixtures live next to the converter and are not served
  // by the SPA. They feed the Cv-series tests and round-trip checks.
  const buffer = typeof bytes === 'string' ? strToU8(bytes) : bytes;
  const outPath = resolve(`tests/fixtures/sources/${name}`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, buffer);
  console.log(`Wrote ${outPath}`);
}

async function emitFolderFile(folder, relPath, bytes) {
  // Folder fixtures back the e2e converter-folder.spec.ts cases. We keep
  // them on disk (not zipped) so Playwright's setInputFiles({ webkitdirectory })
  // can walk them like a real picked directory.
  const buffer = typeof bytes === 'string' ? strToU8(bytes) : bytes;
  const outPath = resolve(`tests/fixtures/folders/${folder}/${relPath}`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, buffer);
  console.log(`Wrote ${outPath}`);
}

async function emitSourceZip(name, files) {
  const bytes = zipSync(files, { level: 9 });
  await emitSource(name, bytes);
}

async function buildValidBasic() {
  const manifest = {
    schema: 'slidestage@1.0',
    id: 'lite-fixture',
    version: '1.0.0',
    title: 'Lite Fixture Deck',
    subtitle: null,
    author: 'SlideStageLite',
    description: 'Small deterministic fixture for loader tests.',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    architecture: 'multi-file',
    dimensions: { width: 1920, height: 1080 },
    totalSlides: 2,
    slides: [
      {
        index: 1,
        id: 'cover',
        label: 'Cover',
        file: 'slides/01-cover.html',
        thumbnail: null,
        notes: 'Cover speaker notes from manifest.',
      },
      {
        index: 2,
        id: 'details',
        label: 'Details',
        file: 'slides/02-details.html',
        thumbnail: null,
        notes: 'Details speaker notes from manifest.',
      },
    ],
    fonts: [],
    tokens: {},
    assets: { totalSize: 0, count: 0, files: [] },
    runtime: {
      presenterTools: 'platform',
      fallbackEntry: null,
      capabilities: ['keyboard-nav', 'speaker-notes'],
    },
    platform: { minSchemaVersion: '1.0', compatibleArchitectures: ['multi-file'] },
    stats: {
      packedAt: '2026-01-01T00:00:00.000Z',
      packerVersion: 'slidestage-lite-fixture@1.0.0',
    },
  };

  await emit('valid-basic.stage', {
    'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
    'shared/tokens.css': strToU8(tokensCss),
    'slides/01-cover.html': strToU8(
      buildSlideHtml('Lite Fixture Deck', 'Slide 1 rendered from a local .stage file.'),
    ),
    'slides/02-details.html': strToU8(
      buildSlideHtml('Details Slide', 'Slide 2 proves navigation works.'),
    ),
  });
}

async function buildMismatchedCounts() {
  // totalSlides intentionally wrong, slides[].index intentionally not 1..N sequential.
  // PR-D1 expects loader to warn and use slides.length, and to renumber index by array order.
  const manifest = {
    schema: 'slidestage@1.0',
    id: 'lite-mismatched',
    version: '1.0.0',
    title: 'Mismatched Counts Deck',
    subtitle: null,
    author: 'SlideStageLite',
    description: 'Fixture for schema relaxation tests (PR-D1).',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    architecture: 'multi-file',
    dimensions: { width: 1920, height: 1080 },
    totalSlides: 7, // wrong on purpose
    slides: [
      {
        index: 5, // wrong on purpose
        id: 'first',
        label: 'First',
        file: 'slides/01-first.html',
        thumbnail: null,
        notes: 'First speaker notes.',
      },
      {
        index: 9, // wrong on purpose
        id: 'second',
        label: 'Second',
        file: 'slides/02-second.html',
        thumbnail: null,
        notes: null,
      },
      {
        index: 12, // wrong on purpose
        id: 'third',
        label: 'Third',
        file: 'slides/03-third.html',
        thumbnail: null,
        notes: null,
      },
    ],
  };

  await emit('mismatched-counts.stage', {
    'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
    'shared/tokens.css': strToU8(tokensCss),
    'slides/01-first.html': strToU8(buildSlideHtml('First slide', 'Index renumbered by D1.')),
    'slides/02-second.html': strToU8(buildSlideHtml('Second slide', 'totalSlides was wrong.')),
    'slides/03-third.html': strToU8(buildSlideHtml('Third slide', 'Schema relaxed in PR-D1.')),
  });
}

async function buildRelaxedId() {
  // The old regex rejected manifest.id values that contained spaces, capital
  // letters, or punctuation. PR-D1 only forbids NUL, "/", "\\", "..", and
  // control characters. Test a real-world-flavored id.
  const manifest = {
    schema: 'slidestage@1.0',
    id: 'Acme Corp — Q4 2026 Pitch (Final)',
    version: '1.0.0',
    title: 'Relaxed Id Deck',
    subtitle: null,
    author: 'SlideStageLite',
    description: 'Fixture for id regex relaxation tests (PR-D1).',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    architecture: 'single-file-html',
    dimensions: { width: 1920, height: 1080 },
    totalSlides: 1,
    slides: [
      {
        index: 1,
        id: 'only-slide',
        label: 'Only slide',
        file: 'slides/01-only.html',
        thumbnail: null,
        notes: 'Architecture stays within the standard slidestage@1.0 enum.',
      },
    ],
  };

  await emit('relaxed-id.stage', {
    'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
    'shared/tokens.css': strToU8(tokensCss),
    'slides/01-only.html': strToU8(
      buildSlideHtml('Relaxed Id Deck', 'PR-D1 accepts loose ids like "Acme Corp — Q4".'),
    ),
  });
}

async function buildTrickyAssets() {
  // Exercises four PR-D2 features in one fixture:
  // 1. <link rel="stylesheet"> inlining where the CSS references a sibling
  //    image (the inline-CSS path-base bug regression test).
  // 2. <style> body with @import "..." (string form, no url()).
  // 3. <iframe srcdoc="..."> whose inner HTML references a package asset.
  // 4. CSS body referenced via @import url(...).
  const manifest = {
    schema: 'slidestage@1.0',
    id: 'tricky-assets',
    version: '1.0.0',
    title: 'Tricky Assets Deck',
    subtitle: null,
    author: 'SlideStageLite',
    description: 'Fixture for HTML rewrite coverage tests (PR-D2).',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    architecture: 'multi-file',
    dimensions: { width: 1920, height: 1080 },
    totalSlides: 1,
    slides: [
      {
        index: 1,
        id: 'tricky',
        label: 'Tricky',
        file: 'slides/01-tricky.html',
        thumbnail: null,
        notes: 'Exercises rewrite gaps fixed in PR-D2.',
      },
    ],
  };

  // shared/theme.css references a sibling image AND imports another sheet.
  const themeCss = `
@import "extra.css";
.tricky { background: url("./pixel.png") no-repeat; }
.tricky h1 { color: var(--accent); }
`;
  const extraCss = `
:root { --accent: #1783ff; }
.tricky { padding: 24px; border: 1px solid var(--accent); }
`;
  // A 1x1 transparent PNG so the iframe load does not error.
  const pixelPng = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);

  const innerSrcdoc = `<!doctype html><html><body><img id="srcdoc-img" src="../shared/pixel.png" alt="srcdoc" /></body></html>`;
  // Escape the inner HTML for the srcdoc attribute. We use the double-quoted
  // attribute form so we only need to escape "&" and double quotes.
  const escapedSrcdoc = innerSrcdoc
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');

  const slideHtml = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="../shared/theme.css" />
    <link rel="preconnect" href="https://fonts.gstatic.com" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;700" />
    <style>@import url("../shared/extra.css");</style>
  </head>
  <body>
    <main class="slide tricky" data-testid="tricky-slide">
      <h1>Tricky Assets Deck</h1>
      <p>srcdoc, inline css, and @import.</p>
      <img id="direct-img" src="../shared/pixel.png" alt="direct" />
      <iframe id="inner" sandbox="allow-scripts" title="inner-frame" srcdoc="${escapedSrcdoc}" style="width:200px;height:80px;border:0"></iframe>
    </main>
  </body>
</html>
`;

  await emit('tricky-assets.stage', {
    'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
    'shared/tokens.css': strToU8(tokensCss),
    'shared/theme.css': strToU8(themeCss),
    'shared/extra.css': strToU8(extraCss),
    'shared/pixel.png': pixelPng,
    'slides/01-tricky.html': strToU8(slideHtml),
  });
}

async function buildSniffedInlineDeck() {
  // html-ppt-skill flavor: <div class="deck"> + <section class="slide"> + runtime.js.
  // No manifest.json — PR-D3 sniffer must classify this as "inline-deck".
  const css = `
:root { color-scheme: light; --bg: #faf8ef; }
body { margin: 0; background: var(--bg); font-family: Inter, sans-serif; }
.deck { display: grid; place-items: center; min-height: 100vh; }
.slide { display: none; padding: 48px; text-align: center; }
.slide.is-active { display: block; }
.slide h1 { font-size: 96px; margin: 0; color: #1f2937; }
.slide p { font-size: 36px; color: #475569; }
`;
  const runtime = `
(function () {
  var slides = document.querySelectorAll('.slide');
  if (slides.length === 0) return;
  slides.forEach(function (s, i) { s.classList.toggle('is-active', i === 0); });
  document.title = document.title + ' (loaded by runtime.js)';
  document.body.dataset.runtimeReady = '1';
})();
`;
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>html-ppt-skill flavored deck</title>
  <link rel="stylesheet" href="assets/theme.css" />
</head>
<body>
  <div class="deck" data-testid="inline-deck">
    <section class="slide" data-title="Cover"><h1>Inline 1</h1><p>html-ppt style</p></section>
    <section class="slide" data-title="Two"><h1>Inline 2</h1><p>section-driven</p></section>
    <section class="slide" data-title="Three"><h1>Inline 3</h1><p>runtime-managed</p></section>
  </div>
  <script src="assets/runtime.js"></script>
</body>
</html>`;

  await emitSourceZip('html-ppt-inline-deck.zip', {
    'index.html': strToU8(html),
    'assets/theme.css': strToU8(css),
    'assets/runtime.js': strToU8(runtime),
  });
}

async function buildSniffedWebComponentDeck() {
  // huashu-design <deck-stage> + <deck-slide> flavor. Sniffer must classify
  // as "webcomponent-deck" and we emit a single wrapper slide for it.
  const css = `
:root { color-scheme: light; }
body { margin: 0; font-family: Inter, sans-serif; background: #fff7ed; }
deck-stage { display: block; min-height: 100vh; }
deck-slide { display: none; padding: 48px; text-align: center; }
deck-slide.is-active { display: block; }
deck-slide h1 { font-size: 96px; margin: 0; color: #b45309; }
`;
  const runtime = `
class DeckStage extends HTMLElement {
  connectedCallback () {
    var slides = this.querySelectorAll('deck-slide');
    slides.forEach(function (s, i) { s.classList.toggle('is-active', i === 0); });
    this.dataset.ready = '1';
  }
}
customElements.define('deck-stage', DeckStage);
class DeckSlide extends HTMLElement {}
customElements.define('deck-slide', DeckSlide);
`;
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>huashu webcomponent deck</title>
  <link rel="stylesheet" href="assets/theme.css" />
</head>
<body>
  <deck-stage data-testid="webcomponent-deck">
    <deck-slide><h1>WC 1</h1></deck-slide>
    <deck-slide><h1>WC 2</h1></deck-slide>
  </deck-stage>
  <script src="assets/deck-stage.js"></script>
</body>
</html>`;

  await emitSourceZip('huashu-webcomponent-deck.zip', {
    'index.html': strToU8(html),
    'assets/theme.css': strToU8(css),
    'assets/deck-stage.js': strToU8(runtime),
  });
}

async function buildSniffedRouterHtml() {
  // huashu-design router flavor: deck_index.html declares window.DECK_MANIFEST
  // and per-slide HTML lives under slides/. Sniffer expands to N real slides.
  const css = `
:root { color-scheme: light; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #ecfeff; color: #0e7490; font-family: Inter, sans-serif; }
h1 { font-size: 96px; margin: 0; }
p { font-size: 36px; }
`;
  const indexHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>huashu router deck</title>
</head>
<body>
  <main>
    <p>Loading slides...</p>
  </main>
  <script>
    window.DECK_MANIFEST = [
      { file: "slides/01-cover.html", label: "Cover" },
      { file: "slides/02-quote.html", label: "Quote" },
      { file: "slides/03-finale.html", label: "Finale" }
    ];
  </script>
</body>
</html>`;

  const slide = (title, body) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="../shared/theme.css" />
</head>
<body data-testid="router-slide">
  <main><h1>${title}</h1><p>${body}</p></main>
</body>
</html>`;

  await emitSourceZip('huashu-router.zip', {
    'deck_index.html': strToU8(indexHtml),
    'shared/theme.css': strToU8(css),
    'slides/01-cover.html': strToU8(slide('Router 1', 'window.DECK_MANIFEST entry 1')),
    'slides/02-quote.html': strToU8(slide('Router 2', 'window.DECK_MANIFEST entry 2')),
    'slides/03-finale.html': strToU8(slide('Router 3', 'window.DECK_MANIFEST entry 3')),
  });
}

async function buildFolderInlineDeckFixture() {
  // Folder-shaped html-ppt-skill inline deck used by tests/e2e/converter-folder.spec.ts.
  // The folder picker counts 3 valid files after filtering noise; we therefore
  // ship index.html + assets/theme.css + assets/runtime.js plus 2 noise paths
  // (.DS_Store and node_modules/foo/index.js) that the walker drops.
  const folder = 'inline-deck';
  const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Folder Inline Deck</title>
  <link rel="stylesheet" href="assets/theme.css" />
</head>
<body>
  <div class="deck" data-testid="folder-inline-deck">
    <section class="slide" data-title="Folder one"><h1>Folder one</h1><p>Slide one from a folder source.</p></section>
    <section class="slide" data-title="Folder two"><h1>Folder two</h1><p>Slide two proves slide navigation in folder mode.</p></section>
  </div>
  <script src="assets/runtime.js"></script>
</body>
</html>`;
  const themeCss = `:root { color-scheme: light; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #f0f9ff; color: #0f172a; }
.deck { display: grid; place-items: center; min-height: 100vh; }
.slide { display: none; padding: 48px; text-align: center; }
.slide.is-active { display: block; }
.slide h1 { font-size: 96px; margin: 0; }
.slide p { font-size: 28px; }
`;
  const runtimeJs = `(function () {
  var slides = document.querySelectorAll('.slide');
  if (slides.length === 0) return;
  slides.forEach(function (s, i) { s.classList.toggle('is-active', i === 0); });
  document.body.dataset.folderRuntimeReady = '1';
})();
`;
  await emitFolderFile(folder, 'index.html', indexHtml);
  await emitFolderFile(folder, 'assets/theme.css', themeCss);
  await emitFolderFile(folder, 'assets/runtime.js', runtimeJs);
  // Noise files: the folder walker must filter both out before counting.
  await emitFolderFile(folder, '.DS_Store', new Uint8Array([0x00, 0x00, 0x00, 0x00]));
  await emitFolderFile(folder, 'node_modules/foo/index.js', 'console.log("filtered");\n');
}

async function buildSniffedPlainHtml() {
  // Single-file HTML page. Used as a converter source fixture (Cv2+).
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Plain Single Page</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fef2f2; color: #991b1b; font-family: Inter, sans-serif; }
    h1 { font-size: 96px; margin: 0; }
    p { font-size: 36px; }
  </style>
</head>
<body data-testid="plain-html-deck">
  <main><h1>Plain HTML</h1><p>No manifest, no deck markup.</p></main>
</body>
</html>`;
  await emitSource('plain-page.html', html);
}

async function buildOversizedDeck() {
  // Fixture that exceeds the default Web inline budget (16 MiB). We
  // ship a single ~20 MiB "font" asset alongside a real slide so:
  //   - In Web mode the loader trips inlineMode='auto' and reports
  //     `inlinedHtmlAvailable === false`. The App layer should then
  //     auto-grant same-origin-storage and surface the sticky banner.
  //   - The transport-published slide still has working virtual URLs.
  //
  // Real CJK fonts compress poorly, so we use a tiny xorshift PRNG to
  // produce a byte stream deflate cannot fold. zip's level=9 over a
  // truly-random 20 MiB blob barely budges from raw size.
  const fillerSize = 20 * 1024 * 1024; // 20 MiB; > 16 MiB default budget
  const filler = new Uint8Array(fillerSize);
  let state = 0xdeadbeef >>> 0;
  for (let i = 0; i < fillerSize; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    filler[i] = state & 0xff;
  }

  const manifest = {
    schema: 'slidestage@1.0',
    id: 'oversized-fixture',
    version: '1.0.0',
    title: 'Oversized Deck',
    subtitle: null,
    author: 'SlideStageLite',
    description:
      'Fixture larger than the default Web inline budget. Used to verify ' +
      'the auto-elevation path that bypasses srcdoc data-URL inlining and ' +
      'falls back to the Service Worker transport.',
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    architecture: 'multi-file',
    dimensions: { width: 1920, height: 1080 },
    totalSlides: 1,
    slides: [
      {
        index: 1,
        id: 'cover',
        label: 'Cover',
        file: 'slides/01-cover.html',
        thumbnail: null,
        notes: 'Inline budget regression fixture.',
      },
    ],
  };

  const slideHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="../shared/tokens.css" />
  </head>
  <body>
    <main class="slide" data-testid="oversized-cover-slide">
      <div>
        <h1>Oversized Deck</h1>
        <p>Auto-elevated via same-origin-storage.</p>
      </div>
    </main>
  </body>
</html>`;

  await emit('oversized.stage', {
    'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
    'shared/tokens.css': strToU8(tokensCss),
    'slides/01-cover.html': strToU8(slideHtml),
    'assets/_mirror/font/oversized-filler.ttf': filler,
  });
}

await buildValidBasic();
await buildMismatchedCounts();
await buildRelaxedId();
await buildTrickyAssets();
await buildSniffedInlineDeck();
await buildSniffedWebComponentDeck();
await buildSniffedRouterHtml();
await buildSniffedPlainHtml();
await buildFolderInlineDeckFixture();
await buildOversizedDeck();

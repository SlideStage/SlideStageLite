# `@slidestage/spec` Fixtures

Golden fixtures shared by every spec consumer (spec / `@slidestage/core`
/ `slidestage-pack` / Lite SPA / Pro server) so their regression tests
all assert the same canonical inputs. Two flavors:

- **`valid/` + `invalid/`** — JSON manifests for `parseManifest()`
  regression. These pin the **schema contract** (what shape a manifest
  must have). The `.stage` zip framing is the producer's job; here we
  only fix the manifest layer.
- **`sources/`** — pre-conversion **framework signature samples** for
  the converter pipeline (sniffer → splitReveal / splitImpress /
  splitInlineDeck / splitWebComponent / splitRouter / wrapSource /
  singleHtml). Each subdirectory is a minimum-complete deck for one
  framework. These let Lite's `convertSource` / `convertFolderSource`
  e2e tests, pack's `tests/build_fixtures.mjs` (consumer), and the
  upcoming Pro deck-pipeline tests all start from the **same bytes** —
  so "what reveal looks like" is decided once, not three times.

## Layout

```
fixtures/
├── valid/
│   ├── minimum.json
│   ├── full.json
│   ├── architecture-multi-file-flat.json
│   ├── architecture-single-file-deckstage.json
│   └── architecture-single-file-html.json
├── invalid/
│   ├── wrong-schema-literal.json
│   ├── wrong-schema-literal.meta.json
│   ├── unknown-architecture.json
│   ├── unknown-architecture.meta.json
│   ├── path-traversal-id.json
│   ├── path-traversal-id.meta.json
│   ├── missing-dimensions.json
│   ├── missing-dimensions.meta.json
│   ├── empty-slides.json
│   └── empty-slides.meta.json
└── sources/
    ├── reveal-basic/         # .reveal > .slides > <section>* (Hakimel reveal.js shape)
    ├── impress-basic/        # #impress > .step* (Bartaz impress.js shape)
    ├── html-ppt-skill/       # inline-deck: .deck > section.slide* + runtime.js
    ├── lewislulu-html-ppt/   # inline-deck with deck-scoped CSS (lewislulu/html-ppt-skill real-world signature)
    ├── huashu-deckstage/     # webcomponent: <deck-stage><deck-slide>* + customElements.define
    ├── huashu-router/        # router: window.DECK_MANIFEST + slides/*.html siblings
    └── plain.html            # plain single-page HTML (no deck framing)
```

## Coverage

### `valid/`

| Fixture | What it exercises |
| --- | --- |
| `minimum.json` | The smallest legal manifest — only spec-required fields. |
| `full.json` | Every optional field populated: `compat.requires` (sorted, deduped), `provenance` (converter chain), `offline` (mirror pass), `assets` (file list), `runtime` (player hints), `platform` (compat gate), `fonts`, `tokens`, `stats`, plus per-slide `duration`/`transition`/`thumbnail`. |
| `architecture-multi-file-flat.json` | `multi-file-flat` — slide files outside the `slides/` prefix. |
| `architecture-single-file-deckstage.json` | `single-file-deckstage` — producer pre-split via `<deck-stage>`-style web component. |
| `architecture-single-file-html.json` | `single-file-html` — single wrap-mode slide with `compat.requires`. |

Every entry MUST be accepted by `parseManifest()` without throwing.

### `invalid/`

Each invalid fixture has a sibling `*.meta.json` file describing the
expected failure mode. Schema of the meta file:

```ts
interface InvalidFixtureMeta {
  /** Human-readable description of why this manifest is invalid. */
  description: string;
  /** Substring expected to appear in the thrown error message. */
  expectErrorIncludes: string;
  /** Whether @slidestage/spec is the layer that rejects this fixture
   *  (vs a runtime-only check like E_MISSING_SLIDE that fires on zip
   *  unpack). All current entries are true. */
  rejectsAtSpec: boolean;
}
```

| Fixture | Failure mode |
| --- | --- |
| `wrong-schema-literal` | `schema !== SCHEMA_LITERAL` ('slidestage@2.0' here). Zod literal check fails. |
| `unknown-architecture` | `architecture = 'galaxy-brain'` is not in `ARCHITECTURES`. Zod enum check fails. |
| `path-traversal-id` | `id = '../etc/passwd'` contains `..` — rejected by the id refine in `manifestSchema`. |
| `missing-dimensions` | Top-level required field omitted; Zod reports `invalid_type` on the `dimensions` path. |
| `empty-slides` | `slides = []` fails `z.array(...).min(1)`; `totalSlides = 0` also fails the positive-int requirement. |

### `sources/`

| Fixture | Framework | What it exercises | Files |
| --- | --- | --- | --- |
| `reveal-basic/` | reveal.js (Hakimel) | `.reveal > .slides > <section>` three-level wrapper preservation; deeply nested `<div>` children (regression-test for the balanced-tag scanner that earlier non-greedy regex would prematurely close); `<aside class="notes">` + `<aside class="speaker-notes">` speaker-note variants; vertical (stacked) sections; `Reveal.initialize()` inline script | `index.html`, `reveal.css`, `dist/reveal.js` |
| `impress-basic/` | impress.js (Bartaz) | `<div id="impress">` scoping; `.step` blocks with `data-x` / `data-y` / `data-rotate` 3D camera attrs; `step id` precedence for `slide.id`; `impress().init()` inline script | `index.html`, `impress.css`, `impress.js` |
| `html-ppt-skill/` | inline-deck (skill-author convention) | `.deck > section.slide` wrapper; `<script src="...runtime.js">`; `speaker-notes/<basename>.md` sidecar lookup | `index.html`, `assets/theme.css`, `assets/runtime.js`, `speaker-notes/01-cover.md`, `speaker-notes/02-two.md` |
| `lewislulu-html-ppt/` | inline-deck (lewislulu real-world signature) | `<html lang data-theme data-themes data-theme-base>` HTML attrs; `<body class="tpl-…">` deck-scoped CSS scope; `<div class="notes">` (lewislulu deck.html style) + `<aside class="notes">` (presenter-mode-reveal style); inline `<script>` inside one slide → triggers `compat.requires`. Regression-tests v0.2 audit fixes | `index.html`, `assets/base.css`, `assets/themes/tokyo-night.css`, `assets/runtime.js` |
| `huashu-deckstage/` | webcomponent | `<deck-stage><deck-slide>*` custom element pair; `<template id="speaker-notes">` inline note variant; `customElements.define` inline script; `notes/<basename>.md` sidecar | `index.html`, `assets/theme.css`, `assets/deck-stage.js`, `notes/01-cover.md` |
| `huashu-router/` | router | Non-`index.html` root (`deck_index.html`); `window.DECK_MANIFEST` manifest-in-script; sibling `slides/*.html` files; `<slide-dir>/<basename>.notes.md` co-located sidecar | `deck_index.html`, `shared/theme.css`, `slides/{01-cover,02-content,03-finale}.html`, `slides/{01-cover,02-content}.notes.md` |
| `plain.html` | plain-html | No deck markup, no manifest; inline `<aside class="notes">` inline note (single-mode extraction) | `plain.html` (single file) |

Every sources fixture is a **minimum-complete signature**: small enough
to read in one screen, but exercises at least one non-trivial converter
edge case (nested elements, scoping, inline scripts, speaker-note
variants, asset path resolution). Adding a new framework → add a new
subdirectory + the corresponding `splitX.ts` in `@slidestage/core`.

## Consumers

- `@slidestage/spec` itself: no test runtime (zero-DOM, platform-agnostic);
  fixtures are referenced by README only.
- `@slidestage/core` Lite app: `src/converter/index.test.ts` reads
  `sources/{reveal-basic,impress-basic,lewislulu-html-ppt,huashu-deckstage}/`
  via `createRequire('@slidestage/spec/package.json')` for e2e
  `convertSource` / `convertFolderSource` regression.
- `slidestage-pack/tests/build_fixtures.mjs` copies `sources/` from
  this spec package into `slidestage-pack/tests/fixtures/` so its e2e
  `run_tests.mjs` / `test_use_core.mjs` / `test_strict_schema.mjs`
  all start from the same bytes. The `slidestage-passthrough.stage`
  zip is generated by pack itself (spec does not ship `.stage` zip
  framing; that's the producer's job).
- `slidestage-pack/tests/test_strict_schema.mjs` also reads
  `invalid/*.json` and asserts each one is rejected by
  `parseManifest` with an error matching its sibling meta file.
- Pro (`apps/api/src/deck-pipeline.*.test.ts`) can consume the same
  sources via `@slidestage/spec` once its deck-pipeline tests are
  expanded (Phase D).

## Adding a fixture

**Manifest fixture (`valid/` or `invalid/`)**:

- Add a JSON file under `valid/` (passes `parseManifest`) or `invalid/`
  (fails `parseManifest`, **plus a sibling `*.meta.json`**).
- Update the manifest tables above and the consumer table.
- Keep fixtures byte-stable: pretty-printed with 2-space indent, ends
  with a newline, no trailing commas. (`pnpm fixtures:format` is the
  future canonical formatter; until then, match the existing files.)

**Sources fixture (`sources/`)**:

- Add a subdirectory under `sources/` (or a single `*.html` file for
  the plain-html case).
- The fixture must be a **minimum-complete framework signature**:
  small enough to read in one screen, but with at least one
  non-trivial edge case (nested elements, scoping, inline scripts,
  speaker-note variants, asset path resolution).
- Update the `sources/` table above.
- The corresponding `splitX.ts` (or `singleHtml.ts` / `wrapSource.ts`)
  in `@slidestage/core` must already exist; spec/fixtures is not the
  place to ship converter implementations.
- Coordinate with `slidestage-pack/tests/build_fixtures.mjs` so the
  next pack release picks up the new fixture from spec rather than
  re-defining it.

The new fixture (manifest **or** source) ships in the next published
tarball automatically via the `files: ["dist", "README.md",
"CHANGELOG.md", "fixtures"]` entry in `package.json`.

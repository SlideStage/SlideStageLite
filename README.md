# SlidesDeckLite

> Open, present, and convert `.hcslides` decks — right in your browser.
> Zero backend. Zero accounts. Zero upload.

SlidesDeckLite is the **local-first sibling** of [SlidesDeckPro](https://github.com/SlideStage/SlidesDeckPro)
(self-hosted platform). They share design tokens, the `.hcslides` container
contract, and the presenter ergonomics — Lite just trades the server for a
single static bundle you can run from `file://`, GitHub Pages, Netlify,
Vercel, an internal Nginx, or anywhere else that serves static files.

🇨🇳 [中文 README](README_cn.md)

---

## Why SlidesDeckLite?

Most slide tools force a tradeoff between **fidelity** (raw HTML/CSS/JS
animations) and **portability** (a single file you can hand off). The
`.hcslides` container resolves that: a zipped folder of static slide HTML
+ a strict manifest, signed by a fingerprint and gated by an explicit
capability list. Lite is a faithful runtime for that container that:

- runs entirely in your tab — no server, no telemetry, no upload;
- sandboxes every slide in an `iframe` and asks for **per-deck consent**
  before unlocking storage, BroadcastChannel, or `window.open`;
- ships PowerPoint-grade presenter tools (speaker view, overview grid,
  laser, spotlight, persistent ink, second-screen audience window);
- converts an `html-ppt-skill` / `huashu-design` deck or a plain HTML
  file into a `.hcslides` package without leaving the tab;
- speaks both English and 简体中文 out of the box.

---

## Feature Tour

| Surface | What it does |
|---|---|
| **Landing** | One-click deck picker, drag-in HTML→`.hcslides` converter, six benefit cards, language switcher. |
| **DeckViewer (single-window)** | Fullscreen black stage with auto-hide presenter toolbar at the bottom — pen, highlighter, eraser, laser, spotlight, blackout/whiteout, undo/clear, persistent color palette. |
| **PresenterView (multi-window)** | Resizable side panel with up-next thumbnail, timer, audience-window status, plus a resizable speaker-notes drawer. Notes are editable per slide and persist to `localStorage`. |
| **AudienceView (popup)** | Second-screen output that mirrors strokes, slide index, blackout, spotlight, and pointer in real time via `BroadcastChannel`. |
| **Trust prompts** | If a deck declares `compat.requires`, Lite blocks rendering until you explicitly grant the listed capabilities for *that* fingerprint. |
| **Converter** | Drop a folder, `.html`, `.zip`, or `.hcslides`; pick a conversion mode (auto / split / wrap / single / passthrough); download a strict `.hcslides`. |
| **i18n** | English + Simplified Chinese, full key parity enforced by tests. URL `?lang=` / `localStorage` / `navigator.language*` resolution. |

---

## Quickstart (Local Dev)

Requirements: **Node ≥ 20**, **pnpm 10.28+**.

```bash
git clone https://github.com/<you>/SlidesDeckLite.git
cd SlidesDeckLite

pnpm install
pnpm dev                     # http://localhost:5173/
```

The `predev` hook generates deterministic fixtures so the "Open sample
deck" button works out of the box.

### Verify your setup

```bash
pnpm typecheck               # tsc -b --noEmit
pnpm test:unit               # vitest (jsdom)
pnpm test:e2e                # playwright (requires `pnpm test:e2e:install`)
pnpm build                   # tsc -b && vite build → dist/
```

---

## Deploy to Production

SlidesDeckLite builds to a vanilla static bundle (`dist/index.html`,
`dist/assets/*`). Any static host works.

### 1. Configure environment (optional)

Copy the template and fill in your filing numbers (or leave empty):

```bash
cp .env.example .env
$EDITOR .env
```

Every `VITE_BEIAN_*` variable is optional. Empty → that chip is not
rendered. See [Configuration](#configuration) below for the full
contract.

> ⚠️ **Quote any URL that contains `#`.** Vite parses `.env*` via
> dotenv, which treats `#` as the start of an inline comment. Use
> `VITE_BEIAN_MPS_URL="https://beian.mps.gov.cn/#/query/..."` (with
> double quotes) — see [`docs/FOOTER_BEIAN.md`](docs/FOOTER_BEIAN.md) for
> the gory details.

### 2. Build

```bash
pnpm build
```

### 3. Upload `dist/`

Generic recipe:

```bash
# Vercel / Netlify drag-and-drop:
#   Project root: SlidesDeckLite
#   Build command: pnpm build
#   Output directory: dist

# Nginx (or any plain webroot):
rsync -av --delete dist/ user@host:/var/www/slidesdecklite/

# GitHub Pages:
pnpm build
npx gh-pages -d dist
```

That's it — no database, no API keys, no runtime config service.

---

## Configuration

All configuration is baked at build time via Vite environment variables.
Live-editing `.env` after `pnpm build` has no effect on `dist/`.

| Variable | Purpose | When empty |
|---|---|---|
| `VITE_BEIAN_ICP_TEXT` | Mainland-China ICP filing number text. | ICP chip is not rendered. |
| `VITE_BEIAN_ICP_URL` | Override for the ICP link target. | Falls back to `https://beian.miit.gov.cn/`. |
| `VITE_BEIAN_MPS_TEXT` | 公安备案 number text. | MPS chip is not rendered. |
| `VITE_BEIAN_MPS_URL` | Full `beian.mps.gov.cn` query URL for your record. | Chip degrades to a non-link `<span>` (logo + text). |

See [`docs/FOOTER_BEIAN.md`](docs/FOOTER_BEIAN.md) for the full env
contract, the `#` quoting pitfall, and a post-build sanity check.

---

## Architecture (Repo Map)

```
SlidesDeckLite/
├── src/
│   ├── app/                  # Top-level SPA shell (App, Footer, LanguageSwitcher, ConverterPanel, TrustPrompt)
│   ├── deck/                 # .hcslides loader + capability sandboxing
│   ├── converter/            # html-ppt-skill / huashu / plain HTML → .hcslides packer
│   ├── viewer/               # DeckViewer + DeckStage + AudienceView
│   ├── presenter/            # Toolbar, AnnotationOverlay, LaserPointer, Spotlight, Blackout, BroadcastChannel sync hook
│   ├── persistence/          # localStorage wrappers (notes, annotations, trust grants)
│   ├── i18n/                 # I18nProvider + en/zh-CN dictionaries
│   ├── styles/globals.css    # Design tokens + every component class (CSS only, no Tailwind)
│   └── main.tsx              # ReactDOM bootstrap
├── bin/convert.ts            # `pnpm convert` CLI (folder/HTML/zip → .hcslides)
├── scripts/build-fixtures.mjs  # Deterministic test fixtures
├── public/                   # Static assets (mpslogo.png for 公安备案 chip, fixtures/ generated at predev/prebuild)
├── design-system/            # MASTER design spec (tokens, components, anti-patterns)
├── docs/                     # AI-generated process notes (not committed; gitignored)
├── tests/                    # Playwright e2e + fixtures (not committed; gitignored)
└── .env.example              # Beian env template — copy to .env on your deploy
```

### Twin Contract with SlidesDeckPro

`src/styles/tokens.test.ts` reads `globals.css` on disk and asserts that
every design token (color, radius, shadow, typography) Lite borrows from
Pro is still present. If anyone ever accidentally drops `--primary` or
renames `.btn.cta`, the unit test fails immediately — drift between the
two products is prevented at CI time.

---

## Development Cheatsheet

```bash
pnpm dev          # Vite dev server
pnpm fixtures     # Regenerate deterministic .hcslides fixtures (auto-runs on pre{dev,build,test})
pnpm convert      # CLI: pack a folder / html / zip into .hcslides
pnpm mirror       # CLI: pre-download external assets into a .hcslides (offline pass)
pnpm typecheck    # tsc -b --noEmit
pnpm test:unit    # vitest (jsdom + react-dom)
pnpm test:e2e     # playwright chromium
pnpm test         # fixtures + typecheck + unit + e2e
pnpm check        # typecheck + production build (CI gate)
pnpm preview      # serve dist/ for a smoke check
```

### `pnpm mirror`: pre-download external assets for offline-first decks

`pnpm mirror` takes a `.hcslides` package and folds every reachable
`https://` image / font / CSS / video / audio into the archive itself,
rewriting slide HTML so the deck plays back identically with **no network
access**. The output is a new `.hcslides` that ships a `manifest.offline`
block — the same structure both Lite and Pro use to render the *"Offline
ready"* badge.

```bash
# Basic usage: write a new package next to the input.
pnpm mirror ./deck.hcslides -o ./deck.offline.hcslides

# Allow external <script>/<iframe> too (off by default; only enable for
# trusted sources because mirrored scripts run inside the deck sandbox).
pnpm mirror ./deck.hcslides -o ./deck.offline.hcslides \
  --include-scripts --include-iframes

# Tighter per-asset and per-pass budgets (defaults: 50 MiB / 500 MiB).
pnpm mirror ./deck.hcslides -o ./deck.offline.hcslides \
  --max-asset-bytes 10485760 --max-total-bytes 209715200

# Emit a sibling Markdown report listing every mirrored URL and every
# skip reason — handy for security review before publishing.
pnpm mirror ./deck.hcslides -o ./deck.offline.hcslides \
  --report ./mirror-report.md
```

The same code runs from the SPA: open **Convert from HTML deck**, tick
*"Pre-download external assets (offline ready)"* and the converter
streams progress as it fetches each URL. See
[`docs/FILE_FORMAT.md` § Offline Mirror Pass](docs/FILE_FORMAT.md#offline-mirror-pass)
for the on-disk contract.

### Tech Stack

- **React 19** + **TypeScript 6** + **Vite 8**
- **fflate** for zip pack/unpack (~30 KB, no native deps)
- **lucide-react** for icons (SVG only — no emoji per design rules)
- **zod 4** for manifest validation
- **vitest 4** + **@testing-library/react 16** + **jsdom 29** for units
- **playwright 1.60** for e2e
- **pnpm 10.28+** workspace-friendly package manager

---

## Testing Philosophy

- **Unit (`src/**/*.test.{ts,tsx}`):** every translatable surface, every
  capability parser, every persistence helper, the design-token twin
  contract, and the Footer's full env matrix. 194 tests today.
- **e2e (`tests/e2e/*.spec.ts`):** Playwright drives the real Vite dev
  server through Chromium — smoke landing, deck open, presenter tools,
  converter round-trip, trust prompts, i18n switches, footer presence.
  Pinned to an empty `VITE_BEIAN_*` baseline so local `.env`s never
  pollute the run.

Run the full battery in one go:

```bash
pnpm test
```

---

## Contributing

PRs and issues welcome — please read
[`design-system/slidesdecklite/MASTER.md`](design-system/slidesdecklite/MASTER.md)
before touching anything visual; Lite intentionally has a **single**
button system, a fixed token palette, and a "no emoji as icon"
anti-pattern list. The twin contract with SlidesDeckPro is enforced by
unit tests, so design drift fails CI.

For Chinese mainland deploys, follow
[`docs/FOOTER_BEIAN.md`](docs/FOOTER_BEIAN.md) when configuring beian
filing numbers — incorrect quoting will silently truncate your audit
URL.

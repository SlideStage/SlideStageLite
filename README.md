<p align="center">
  <a href="https://slidestage.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="public/brand/png/slidestage-logo-horizontal-on-dark@2x.png">
      <img src="public/brand/png/slidestage-logo-horizontal@2x.png" alt="SlideStage Lite" width="520">
    </picture>
  </a>
</p>

<p align="center">
  <strong>Open, present, and convert <code>.stage</code> decks — right in your browser.</strong><br/>
  Zero backend · Zero accounts · Zero upload.
</p>

<p align="center">
  <a href="https://slidestage.dev"><img alt="Website" src="https://img.shields.io/badge/website-slidestage.dev-06B6D4?style=flat-square"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Proprietary-DC2626?style=flat-square"></a>
  <a href="README_cn.md"><img alt="简体中文" src="https://img.shields.io/badge/lang-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-F59E0B?style=flat-square"></a>
</p>

---

SlideStage Lite is the **local-first sibling** of [SlideStage Pro](https://github.com/SlideStage/SlideStagePro)
(self-hosted platform). They share design tokens, the `.stage` container
contract, and the presenter ergonomics — Lite just trades the server for
a single static bundle you can run from `file://`, deploy to **Cloudflare
Workers** (the supported web host), or upload to any other plain
static-file host (GitHub Pages, internal Nginx, …).

### SlideStage ecosystem

<table>
  <tr>
    <td align="center" width="33%">
      <a href="https://github.com/SlideStage/SlideStageLite"><img src="public/brand/png/slidestage-mark.png" width="84" alt="SlideStage Lite"></a><br/>
      <strong>SlideStage Lite</strong><br/>
      <sub>Local-first runtime</sub><br/>
      <sub>Open, present, convert <code>.stage</code> in any browser.</sub>
    </td>
    <td align="center" width="33%">
      <a href="https://github.com/SlideStage/SlideStagePro"><img src="public/brand/png/slidestage-pro-mark.png" width="84" alt="SlideStage Pro"></a><br/>
      <strong>SlideStage Pro</strong><br/>
      <sub>Self-hosted platform</sub><br/>
      <sub>Multi-user library, notes &amp; annotations, Docker-deployable.</sub>
    </td>
    <td align="center" width="33%">
      <a href="https://github.com/SlideStage/slidestage-pack"><img src="public/brand/png/slidestage-pack-mark.png" width="84" alt="slidestage-pack"></a><br/>
      <strong>slidestage-pack</strong><br/>
      <sub>Agent skill packer</sub><br/>
      <sub>Turn any HTML deck into a <code>.stage</code> file.</sub>
    </td>
  </tr>
</table>

---

## Why SlideStage Lite?

Most slide tools force a tradeoff between **fidelity** (raw HTML/CSS/JS
animations) and **portability** (a single file you can hand off). The
`.stage` container resolves that: a zipped folder of static slide HTML
+ a strict manifest, signed by a fingerprint and gated by an explicit
capability list. Lite is a faithful runtime for that container that:

- runs entirely in your tab — no server, no telemetry, no upload;
- sandboxes every slide in an `iframe` and asks for **per-deck consent**
  before unlocking storage, BroadcastChannel, or `window.open`;
- ships PowerPoint-grade presenter tools (speaker view, overview grid,
  laser, spotlight, persistent ink, second-screen audience window);
- converts a `reveal.js` / `impress.js` / `html-ppt-skill` /
  `huashu-design` deck or a plain HTML file into a `.stage` package
  without leaving the tab (reveal/impress default to `wrap` to preserve
  the full original runtime; explicit `--mode split` available);
- speaks both English and 简体中文 out of the box.

---

## Feature Tour

| Surface | What it does |
|---|---|
| **Landing** | Minimal "instant-tool" surface: a centered dropzone that opens `.stage` files (drop or click), with two secondary actions below (open a sample deck, toggle the HTML→`.stage` converter) and an English / 简体中文 switcher. The full product pitch lives on [slidestage.dev](https://slidestage.dev). |
| **DeckViewer (single-window)** | Fullscreen black stage with auto-hide presenter toolbar at the bottom — pen, highlighter, eraser, laser, spotlight, blackout/whiteout, undo/clear, persistent color palette. |
| **PresenterView (multi-window)** | Resizable side panel with up-next thumbnail, timer, audience-window status, plus a resizable speaker-notes drawer. Notes are editable per slide and persist to `localStorage`. |
| **AudienceView (popup)** | Second-screen output that mirrors strokes, slide index, blackout, spotlight, and pointer in real time via `BroadcastChannel`. |
| **Trust prompts** | If a deck declares `compat.requires`, Lite blocks rendering until you explicitly grant the listed capabilities for *that* fingerprint. |
| **Converter** | Drop a folder, `.html`, `.zip`, or `.stage`; pick a conversion mode (auto / split / wrap / single / passthrough); download a strict `.stage`. |
| **i18n** | English + Simplified Chinese, full key parity enforced by tests. URL `?lang=` / `localStorage` / `navigator.language*` resolution. |

---

## Quickstart (Local Dev)

Requirements: **Node ≥ 20**, **pnpm 10.28+**.

```bash
git clone https://github.com/SlideStage/SlideStageLite.git
cd SlideStageLite

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

SlideStage Lite builds to a vanilla static bundle (`dist/index.html`,
`dist/assets/*`, `dist/stage-sw.js`, `dist/fixtures/*`). The supported
production host is **Cloudflare Workers** (static-assets binding).

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

### 2. Deploy to Cloudflare Workers

The repo ships a ready-to-use `wrangler.jsonc` pointing at `./dist` with
SPA fallback enabled (real files like `/stage-sw.js` are still served as
files; missing routes fall back to `index.html`). You don't need to add
wrangler as a dependency — `pnpm dlx wrangler` fetches it on demand.

```bash
pnpm install
pnpm preview:cloudflare   # local: pnpm build && wrangler dev
pnpm deploy:cloudflare    # prod : pnpm build && wrangler deploy
```

The first deploy will prompt you to authenticate with
`wrangler login` (browser-based OAuth). Subsequent deploys reuse the
cached credentials. For non-interactive CI, set the standard
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` env vars before
calling `pnpm deploy:cloudflare`.

### 3. Other static hosts (optional)

Because `dist/` is plain files, any static host still works. Lite is no
longer tested or documented against Vercel; the bundle does run there
but you're on your own for `vercel.json` / SPA fallback config.

```bash
# Nginx (or any plain webroot):
rsync -av --delete dist/ user@host:/var/www/slidestagelite/

# GitHub Pages:
pnpm build
npx gh-pages -d dist
```

That's it — no database, no API keys, no runtime config service.

---

## Desktop App

SlideStage Lite also ships as a self-contained desktop app on macOS and
Windows. Both editions bundle the same React shell behind a Tauri 2
shell, share the same `.stage` runtime, and use the same in-app
auto-updater driven by a static `latest.json` manifest hosted on GitHub
Releases (with a `updates.slidestage.dev` fallback for networks where
GitHub is unreachable).

### Download

Latest releases live at
<https://github.com/SlideStage/SlideStageLite/releases>. Pick:

| Platform                          | File                                                   |
| --------------------------------- | ------------------------------------------------------ |
| macOS (Apple Silicon)             | `SlideStageLite-<version>-macOS-AppleSilicon.dmg`      |
| macOS (Intel)                     | `SlideStageLite-<version>-macOS-Intel.dmg`             |
| Windows 10/11 (x64)               | `SlideStageLite-<version>-Windows-x64-setup.exe`       |

System requirements:

- macOS 12.0+ (Monterey or later)
- Windows 10 version 1809+ or Windows 11; the WebView2 Evergreen Runtime
  (preinstalled on Windows 11; the installer offers to fetch it for
  Windows 10).

### Install (Windows)

1. Download `SlideStageLite-<version>-Windows-x64-setup.exe`.
2. Double-click it. Windows Defender SmartScreen may show a blue
   "Unrecognized app" dialog because the MVP build is **not yet code
   signed** — click **More info** → **Run anyway**. You only have to
   do this once per major version; SmartScreen remembers the choice.
3. NSIS installs the app per-user (no admin / UAC prompt) and adds a
   Start menu shortcut. Double-clicking a `.stage` file from Explorer
   will now open SlideStage Lite directly.

If SmartScreen still refuses to launch the installer after "Run
anyway":

- Right-click the downloaded `.exe` → **Properties** → tick
  **Unblock** at the bottom of the General tab → **Apply** → re-run
  the installer.

We are working on code-signing the Windows build. The
[`docs/WINDOWS_DISTRIBUTION.md`](docs/WINDOWS_DISTRIBUTION.md) doc
tracks the planned upgrade paths (Azure Trusted Signing, SignPath,
or MSIX → Microsoft Store).

### Install (macOS)

1. Download the `.dmg` matching your Mac's chip.
2. Open the disk image and drag the `SlideStage Lite` icon to the
   `Applications` folder.
3. macOS Gatekeeper accepts the build immediately because the DMG is
   signed with a Developer ID certificate and stapled with an Apple
   notarization ticket.

### Auto-updates

After installation, SlideStage Lite checks for updates at launch and
when you click **Help → Check for Updates…** (Windows) or
**SlideStage Lite → Check for Updates…** (macOS, in the application
menu). When a new version is available:

- An update banner appears on the landing page with a single
  "Install update" button.
- The download progress is byte-accurate when the server reports
  `Content-Length`; the new build is signature-verified against the
  minisign public key baked into the running binary, then installed
  and relaunched silently.

You can dismiss the banner per-version — it stays hidden until a
strictly-newer release ships.

### Build the desktop app from source

Requirements (in addition to the Quickstart):
- **Rust 1.77+** (`rustup install stable`)
- macOS: Xcode Command Line Tools (`xcode-select --install`)
- Windows: Visual Studio Build Tools 2022 with the "Desktop
  development with C++" workload and the Windows 10/11 SDK

```bash
pnpm tauri:dev      # dev: hot-reload Tauri + Vite (no installer)
pnpm tauri:build    # release: builds .dmg / .exe under
                    #   src-tauri/target/<triple>/release/bundle/
```

See [`docs/AUTO_UPDATER.md`](docs/AUTO_UPDATER.md),
[`docs/MACOS_NOTARIZATION.md`](docs/MACOS_NOTARIZATION.md), and
[`docs/WINDOWS_DISTRIBUTION.md`](docs/WINDOWS_DISTRIBUTION.md) for the
full release pipeline.

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
SlideStageLite/
├── src/
│   ├── app/                  # Top-level SPA shell (App, Footer, LanguageSwitcher, ConverterPanel, TrustPrompt)
│   ├── deck/                 # .stage loader + capability sandboxing
│   ├── converter/            # html-ppt-skill / huashu / plain HTML → .stage packer
│   ├── viewer/               # DeckViewer + DeckStage + AudienceView
│   ├── presenter/            # Toolbar, AnnotationOverlay, LaserPointer, Spotlight, Blackout, BroadcastChannel sync hook
│   ├── persistence/          # localStorage wrappers (notes, annotations, trust grants)
│   ├── i18n/                 # I18nProvider + en/zh-CN dictionaries
│   ├── styles/globals.css    # Design tokens + every component class (CSS only, no Tailwind)
│   └── main.tsx              # ReactDOM bootstrap
├── bin/convert.ts            # `pnpm convert` CLI (folder/HTML/zip → .stage)
├── scripts/build-fixtures.mjs  # Deterministic test fixtures
├── public/                   # Static assets (mpslogo.png for 公安备案 chip, fixtures/ generated at predev/prebuild)
├── design-system/            # MASTER design spec (tokens, components, anti-patterns)
├── docs/                     # AI-generated process notes (not committed; gitignored)
├── tests/                    # Playwright e2e + fixtures (not committed; gitignored)
└── .env.example              # Beian env template — copy to .env on your deploy
```

### Twin Contract with SlideStage Pro

`src/styles/tokens.test.ts` reads `globals.css` on disk and asserts that
every design token (color, radius, shadow, typography) Lite borrows from
Pro is still present. If anyone ever accidentally drops `--primary` or
renames `.btn.cta`, the unit test fails immediately — drift between the
two products is prevented at CI time.

---

## Development Cheatsheet

```bash
pnpm dev          # Vite dev server
pnpm fixtures     # Regenerate deterministic .stage fixtures (auto-runs on pre{dev,build,test})
pnpm convert      # CLI: pack a folder / html / zip into .stage
pnpm mirror       # CLI: pre-download external assets into a .stage (offline pass)
pnpm typecheck    # tsc -b --noEmit
pnpm test:unit    # vitest (jsdom + react-dom)
pnpm test:e2e     # playwright chromium
pnpm test         # fixtures + typecheck + unit + e2e
pnpm check        # typecheck + production build (CI gate)
pnpm preview      # serve dist/ for a smoke check
```

### `pnpm mirror`: pre-download external assets for offline-first decks

`pnpm mirror` takes a `.stage` package and folds every reachable
`https://` image / font / CSS / video / audio into the archive itself,
rewriting slide HTML so the deck plays back identically with **no network
access**. The output is a new `.stage` that ships a `manifest.offline`
block — the same structure both Lite and Pro use to render the *"Offline
ready"* badge.

```bash
# Basic usage: write a new package next to the input.
pnpm mirror ./deck.stage -o ./deck.offline.stage

# Allow external <script>/<iframe> too (off by default; only enable for
# trusted sources because mirrored scripts run inside the deck sandbox).
pnpm mirror ./deck.stage -o ./deck.offline.stage \
  --include-scripts --include-iframes

# Tighter per-asset and per-pass budgets (defaults: 50 MiB / 500 MiB).
pnpm mirror ./deck.stage -o ./deck.offline.stage \
  --max-asset-bytes 10485760 --max-total-bytes 209715200

# Emit a sibling Markdown report listing every mirrored URL and every
# skip reason — handy for security review before publishing.
pnpm mirror ./deck.stage -o ./deck.offline.stage \
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
[`design-system/slidestagelite/MASTER.md`](design-system/slidestagelite/MASTER.md)
before touching anything visual; Lite intentionally has a **single**
button system, a fixed token palette, and a "no emoji as icon"
anti-pattern list. The twin contract with SlideStage Pro is enforced by
unit tests, so design drift fails CI.

For Chinese mainland deploys, follow
[`docs/FOOTER_BEIAN.md`](docs/FOOTER_BEIAN.md) when configuring beian
filing numbers — incorrect quoting will silently truncate your audit
URL.

---

## License

SlideStage Lite is **proprietary** software — see [`LICENSE`](LICENSE) for
the full text. In short:

- Running the published binaries and consuming the published
  `@slidestage/*` npm packages in your own private project is permitted.
- Copying, modifying, sublicensing, redistributing, or training ML
  models on the source code requires a separately negotiated written
  agreement.
- The SlideStage trademarks, logos, and brand assets under
  `public/brand/` are **not** licensed for any third-party use.

For commercial licensing, OEM, or white-label inquiries, contact
[licensing@slidestage.dev](mailto:licensing@slidestage.dev).

# SlideStage Lite — Changelog

All notable changes to the SlideStage Lite app and its `@slidestage/*`
packages live here. Per-package `CHANGELOG.md` files reference the
relevant sections of this file.

This project follows [Semantic Versioning](https://semver.org/). Until
1.0 the public API of every `@slidestage/*` package may evolve between
0.x minor releases; we will call out breaking changes explicitly.

---

## 0.4.0 — 2026-06-06

Client-side PDF export lands in the viewer: turn any inlined `.stage`
deck into a one-slide-per-page PDF without a server, an account, or an
upload. Existing desktop users pick this up through the in-app updater
on next launch — same minisign keypair, no reinstall.

### Highlights — PDF export

- **Export PDF from the viewer.** A new opt-in "Export PDF" action in
  the deck viewer header rasterizes each slide from its sandboxed
  iframe and assembles a PDF (one slide per page, deck-native aspect
  ratio) entirely client-side. `pdf-lib` is pulled in via dynamic
  import so it stays out of the initial bundle — visitors who never
  export never download it.
- **Per-slide progress.** The action reports capture progress slide by
  slide and re-enables once the file is ready.
- **Gated to inlined decks.** Streamed / oversized decks that aren't
  fully in memory surface an explanatory disabled state instead of a
  broken export. EN + zh-CN strings throughout.
- **Shared surface.** The capability is threaded through the shared
  `@slidestage/ui` viewer header and the `@slidestage/lite-preset`
  viewer so downstream consumers inherit it.

### Highlights — Landing

- **Web-only desktop nudge.** The deck-closed landing shell shows a
  single muted line (hidden in the Tauri build via `!isTauri()`)
  pointing web visitors to the desktop download at `slidestage.dev`.
  One line, not a marketing block. EN + zh-CN. Unrelated to PDF export.

### Download for your device

| Your device | Download |
| --- | --- |
| macOS — Apple Silicon (M1/M2/M3/M4) | [`SlideStageLite-0.4.0-macOS-AppleSilicon.dmg`](https://github.com/SlideStage/SlideStageLite/releases/download/v0.4.0/SlideStageLite-0.4.0-macOS-AppleSilicon.dmg) |
| macOS — Intel | [`SlideStageLite-0.4.0-macOS-Intel.dmg`](https://github.com/SlideStage/SlideStageLite/releases/download/v0.4.0/SlideStageLite-0.4.0-macOS-Intel.dmg) |
| Windows 10/11 (64-bit) | [`SlideStageLite-0.4.0-Windows-x64-setup.exe`](https://github.com/SlideStage/SlideStageLite/releases/download/v0.4.0/SlideStageLite-0.4.0-Windows-x64-setup.exe) |

Not sure which Mac? Apple menu → About This Mac — if the chip reads
"Apple M…" choose Apple Silicon, otherwise choose Intel.

Existing 0.3.x desktop users will see the in-app update banner on next
launch and can install in place.

---

## 0.3.0 — 2026-05-28

Markdown lands in the presenter view, slide-internal Markdown gains GFM
table support, and the reveal.js / impress.js → `.stage` converter is
now native end-to-end. Existing 0.2.x desktop users will pick this up
through the in-app updater on next launch — same minisign keypair, no
reinstall.

### Highlights — Presenter view

- **Speaker notes render Markdown.** Code blocks, links, lists,
  headings, emphasis, blockquotes, and GFM tables all render in the
  presenter window's notes panel. The same `renderMarkdown` also
  powers in-slide Markdown viewers, so deck authors can drop GFM
  table syntax anywhere instead of falling back to handwritten HTML.

### Highlights — Converter

- **Native reveal.js / impress.js splitter.** `pnpm convert` and the
  in-app Web Converter route `.html`, zip, and folder inputs through
  a native splitter instead of string-slicing scripts. New e2e suites
  cover round-trip, folder ingest, oversized decks, tricky assets,
  relaxed manifests, and the trust prompt.
- **`reveal-basic` template ships its bundled `reveal.js`.** A
  `.gitignore` rule was silently eating
  `packages/spec/templates/reveal-basic/dist/reveal.js`, so converted
  decks fell through to a missing-script error. The bundle is now
  tracked and ships with the template.

### Highlights — Architecture

- **`@slidestage/spec` and `@slidestage/brand` extracted as standalone
  workspace packages on npm.** Spec owns the `.stage` schema, manifest
  validation, path safety, trust capability, and fixtures. Brand owns
  marks, wordmarks, the product registry, and the ecosystem README
  generator. SlideStagePack and SlideStagePro consume both via
  `@slidestage/<pkg>@<semver>` — no source-level coupling.
- **GitHub Releases is reserved for the desktop app.** Per-package
  `@slidestage/<pkg>@<version>` Releases no longer auto-create on npm
  publish (`createGithubReleases: false` on the changesets action).
  npm publishing itself is unchanged; the @slidestage scope on
  npmjs.com is still the SoT for package consumers.

### Downloads

| Platform | File |
| --- | --- |
| macOS Apple Silicon | `SlideStageLite-0.3.0-macOS-AppleSilicon.dmg` |
| macOS Intel | `SlideStageLite-0.3.0-macOS-Intel.dmg` |
| Windows x64 | `SlideStageLite-0.3.0-Windows-x64-setup.exe` |

Existing 0.2.x desktop users will see the in-app update banner on next
launch and can install in place. Fresh installs should grab the DMG /
NSIS installer above.

---

## 0.2.1 — 2026-05-24

Windows desktop bundle reaches feature parity with macOS: NSIS installer,
in-app auto-updater (sharing the macOS minisign keypair and the same
`latest.json` manifest), and a `Help → Check for Updates…` / `Help →
About SlideStage Lite` menu surface. This release also introduces the
macOS application-menu `Check for Updates…` item; both platforms now
drive the manual update flow through the same `runManualUpdateCheck`
entry point.

### Highlights — Windows

- **NSIS installer.** Track 2 (MVP) ships an unsigned `currentUser`-mode
  NSIS `.exe` bundle (`SlideStageLite-<version>-Windows-x64-setup.exe`).
  No UAC prompt on install or update, Start Menu shortcut by default,
  WebView2 fetched on-demand via the download bootstrapper (~6 MB
  installer; Windows 11 already has WebView2 pre-installed; Windows 10
  1809+ pulls the runtime on first launch). Code signing is intentionally
  deferred — Defender SmartScreen "Unrecognized app" guidance lives in
  the README and `docs/WINDOWS_DISTRIBUTION.md` along with the
  Azure Trusted Signing / SignPath upgrade hooks.
- **Auto-updater is the same plumbing as macOS.** The Windows build
  reuses the existing `tauri-plugin-updater` flow with the same minisign
  public key baked into `tauri.conf.json > plugins.updater.pubkey`, the
  same `latest.json` manifest, and the same dual endpoints
  (`releases/latest/download/latest.json` + `updates.slidestage.dev`
  fallback). `scripts/build-update-manifest.mjs` learned a
  `--merge-existing` flag that lets the Windows pipeline merge a
  `windows-x86_64` block into an already-published `latest.json` without
  evicting `darwin-*` entries — required because the macOS DMG is built
  locally while the Windows installer is built on a GitHub Actions
  `windows-latest` runner.
- **`Help → Check for Updates…`** mirrors the macOS app-menu trigger.
  Same Rust event (`menu:check-update`), same `runManualUpdateCheck`
  flow on the front-end, same locale-aware `plugin-dialog` modals.
  `set_check_update_menu_state` learned to recurse one level into
  submenus so the toggle works whether the item lives at the top of
  the App menu (macOS) or nested under Help (Windows).
- **`Help → About SlideStage Lite`** uses Tauri's
  `PredefinedMenuItem::about` with an `AboutMetadata` populated from
  `Cargo.toml`. Windows pops the native About dialog with name, version,
  copyright, and the slidestage.dev website link — equivalent
  information to macOS' `About SlideStage Lite` Sparkle entry.
- **`.stage` file association + `stage://` deep-links.** NSIS auto-
  registers the file extension at install time; the Rust setup also
  calls `DeepLinkExt::register_all()` at runtime as a defensive
  fallback (writes under HKCU, no admin rights) to dodge Tauri's
  historic NSIS deep-link registration regressions (#10095).
  `single-instance` is wired with the `deep-link` feature so an open
  app handles `stage://` URLs without spawning a second process.

### Highlights — macOS

- **Native menu entry.** The macOS app menu now includes a
  `Check for Updates…` item, slotted between `About SlideStage Lite`
  and `Services` per the Safari / Xcode / Sparkle convention. Click it
  to force an immediate manifest probe regardless of whether a deck is
  open — the silent boot probe + `UpdateBanner` continues to handle
  the passive "new release available" surface on the landing page.
- **Native dialog feedback.** Manual checks surface their result
  through `@tauri-apps/plugin-dialog`: an info dialog announces
  "You're up to date" with the running version, a confirm dialog
  (Install Now / Later) offers to install the new release, and error
  states report the failure reason without dismissing the menu trigger
  for next launch.
- **Visual feedback on the menu itself.** The menu item swaps to
  `Checking for Updates…` and goes disabled while the manifest probe
  is running, and stays disabled through the install pass so a second
  click cannot accidentally re-fire the flow. The Rust side exposes a
  `set_check_update_menu_state` command that the front-end uses to
  drive the toggle from a `try`/`finally`.
- **Locale-aware copy.** All dialog text follows the app locale
  (zh-CN + en); the menu item text is hard-coded English to match
  macOS convention.
- **Boundary preserved.** Edit / View / Window / Help submenus on
  macOS are untouched — only the App submenu is rebuilt — so user
  expectations for standard macOS shortcuts (Cmd-W, Cmd-M, etc.) stay
  intact.

### `@slidestage/lite-preset`

- **New:** `desktop/manualUpdateCheck` — exports
  `runManualUpdateCheck(labels)`, the imperative entry point the
  `LiteApp` shell wires to the `menu:check-update` Tauri event. Pure
  TypeScript, no React dependency, all i18n strings supplied by the
  caller. Works identically on macOS and Windows.
- **New peer dependency (optional):** `@tauri-apps/plugin-dialog`
  alongside the existing `plugin-updater` / `plugin-process`. Marked
  optional so the web bundle never installs it.
- i18n: new keys under `menu.checkUpdate.*` (zh-CN + en) covering the
  up-to-date / available / error / install-error dialog variants and
  the Install / Later confirm-button labels.

### Desktop

- `src-tauri/src/lib.rs`: cross-platform menu setup in `setup()`.
  - macOS: takes `Menu::default(app)`, drops item[0] (the OS-generated
    App submenu) and inserts a hand-built submenu that mirrors the
    standard layout plus the new `Check for Updates…` item.
  - Windows: attaches a window menu bar with a `Help` submenu containing
    `Check for Updates…`, a separator, and `About SlideStage Lite`
    (native dialog via `PredefinedMenuItem::about`).
  - Both platforms: `on_menu_event` forwards `check_updates` clicks as
    the `menu:check-update` Tauri event.
  - `set_check_update_menu_state(checking: bool)` toggles the menu item
    text / enabled state. Recurses one level into submenus so it works
    on Windows where the item is nested under `Help`.
  - Windows / Linux setup also calls `DeepLinkExt::register_all()` as a
    runtime fallback for the `stage://` scheme registration.
- `src-tauri/tauri.conf.json`: `bundle.windows.nsis` switched to the
  Tauri 2.x schema (`installMode: "currentUser"`, `languages: [English,
  SimpChinese]`, etc.) and `createUpdaterArtifacts: true` so the
  bundler emits `.nsis.zip` + `.sig` for the updater pipeline.
- `src-tauri/capabilities/default.json`: `dialog:allow-open` upgraded
  to `dialog:default` so the front-end can call `confirm` and
  `message` in addition to the file picker. `updater:default` /
  `process:default` / `process:allow-restart` were already in place
  from 0.2.0.

### Release pipeline

- **New:** `scripts/release-windows.mjs` — orchestrates the Windows
  bundle on a Windows host (refuses to run on non-`win32`). Same
  `--dry-run` / `--skip-updater` / `--upload` flags as
  `release-macos.mjs`. Invokes `build-update-manifest.mjs
  --merge-existing` so the Windows `windows-x86_64` block joins the
  existing macOS blocks without overwriting them.
- **New:** `.github/workflows/release-windows.yml` — runs on tag push
  (`v*.*.*`) and `workflow_dispatch`. Uses the same
  `TAURI_SIGNING_PRIVATE_KEY{,_PASSWORD}` repository secrets the macOS
  release machine consumes locally, runs `pnpm fixtures && pnpm
  typecheck && pnpm test:unit` as a sanity gate before the bundler
  (catches Windows-only regressions before release), then attaches
  artifacts to the matching GitHub Release via `gh release upload
  --clobber`.
- `scripts/build-update-manifest.mjs`: new `--merge-existing` flag,
  Windows + Linux Rust triple → platform-key mappings, hyphenated
  artifact rename (`SlideStageLite-<v>-Windows-x64-setup.exe`).
- `scripts/desktop-smoke.mjs`: new Windows code path using `tasklist`
  / `taskkill`, with a 60 MB binary size cap (Tauri + WebView2 host is
  larger than the 25 MB macOS cap).

### Docs

- `docs/WINDOWS_DISTRIBUTION.md` — full Windows distribution playbook,
  including the Track 2 (NSIS unsigned MVP) defaults, the rationale
  for each decision, and the Azure Trusted Signing / SignPath /
  MSIX-via-Store upgrade paths.
- `docs/AUTO_UPDATER.md` extended to cover the macOS + Windows
  dual-runner flow and the `--merge-existing` manifest contract.
- `README.md` / `README_cn.md` — added Windows download / SmartScreen
  guidance to the "Desktop App" section.
- `.env.example` — documented the shared `TAURI_SIGNING_PRIVATE_KEY`
  contract for Windows GHA secrets.

### Release pipeline hardening (during first publish)

Five latent bugs surfaced while shipping the first cross-platform
release. They are fully written up in `.memory/desktop-tauri.md`
under "Release Retrospective — v0.2.1"; the short version:

- `936a0ff` — `latest.json` cross-platform merge: mac dual-arch was
  overwriting its own block; the Windows GHA runner was overwriting
  the mac block. macOS now passes `--merge-existing`; Windows seeds
  `dist-desktop/latest.json` from the release before merging.
- `e69ee83` — `release-windows.yml` Node `20` → `22` (pnpm 11
  requires `node:sqlite` from Node 22.5).
- `0bb7cee` — `release-*.mjs` key validation recognizes the base64
  envelope (`dW50cnVzdGVkIGNvbW1lbnQ6…`) so GHA secrets containing
  raw keyfile contents aren't mis-classified as missing paths.
- `41986fc` — `RunEvent::Opened` cfg-gated to macOS (the variant
  doesn't exist in Tauri's enum on Windows/Linux; the closure was
  rejecting the entire crate at compile time).
- `0af4e96` — adopt Tauri 2.x Windows updater format: bundler now
  ships `-setup.exe` + `-setup.exe.sig` (the `.nsis.zip` wrapper from
  1.x is gone). Both release-windows.mjs and build-update-manifest.mjs
  updated to match.

Known follow-up for v0.2.2: extend the upload regex in
`release-windows.mjs` to include `*.exe.sig` (currently the signature
is only inline-embedded in `latest.json`, not uploaded as a separate
asset). The updater works correctly without it; manual `minisign -V`
verification of the installer does not.

---

## 0.2.0 — 2026-05-22

Native in-app auto-updater on the desktop.

### Highlights

- **Tauri 2 native auto-updater.** The desktop build now uses
  `@tauri-apps/plugin-updater` to fetch a static `latest.json`
  manifest, verify the bundled `.app.tar.gz.sig` against a minisign
  public key baked into `tauri.conf.json`, download the new build,
  install it, and relaunch — all inside the running app. No more
  "click the link, drag the DMG to Applications" two-step.
- **Dual endpoints.** Tauri tries the GitHub Releases manifest first
  (`releases/latest/download/latest.json`) and falls back to a
  mirror at `updates.slidestage.dev/latest.json` if GitHub is
  unreachable. Both URLs return the same signed manifest.
- **Per-version dismissal.** The banner remembers the version the
  user dismissed and stays quiet until a strictly newer release
  appears.
- **Five-state UI.** The new banner walks the user through
  `available → downloading → installing → restarting`, with a
  fifth `error` state that supports retry. Progress is byte-accurate
  when the server returns Content-Length; a striped indeterminate
  bar covers the case when it doesn't.
- **Release pipeline upgrades.** `pnpm release:macos` now also
  emits `<app>.app.tar.gz` + `.sig`, runs
  `scripts/build-update-manifest.mjs` to write `dist-desktop/latest.json`,
  and accepts a new `--upload` flag that attaches every artifact to
  the matching GitHub Release via `gh release upload --clobber`.
- **Web build is untouched.** All `@tauri-apps/plugin-updater` and
  `@tauri-apps/plugin-process` imports are dynamic and gated by
  `isTauri()`, so the Vite bundle never ships the updater code to
  browser users — the chunks split out to ~1.4 KB of lazy-loaded JS
  that web users will never download.

### Breaking changes

- `packages/lite-preset/src/desktop/updateCheck.ts` public API
  changed: `checkForUpdate(opts)` now takes no arguments and
  returns `{ version, currentVersion, notes, publishedAt }` instead
  of `{ tag, version, releaseUrl, publishedAt, notes }`. New
  `installUpdate(onProgress)` API replaces "open the release page
  in the browser". The semver helpers (`compareSemver`,
  `fetchLatestRelease`) are gone — Tauri's plugin owns the
  comparison and the network call.
- `update.cta` i18n key replaced by `update.cta.install` (and
  `update.cta.retry`); new keys `update.progress.body`,
  `update.progress.detail`, `update.progress.detailUnknown`,
  `update.installing`, `update.restarting`, `update.error`.
- `bundle.createUpdaterArtifacts` is `true` by default. Pass
  `pnpm release:macos --skip-updater` for the legacy DMG-only flow.

### Operational notes

- Run `pnpm updater:keygen` once to produce the minisign keypair,
  paste the public key into `tauri.conf.json > plugins.updater.pubkey`,
  and set `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  in `.env.local`. Losing either makes shipping updates the existing
  fleet accepts impossible — back the keypair up offline.
- Full setup walkthrough lives in `docs/AUTO_UPDATER.md`; condensed
  reference in `.memory/desktop-tauri.md`.

---

## 0.1.1 — 2026-05-21

Desktop polish + Mac App Store prep.

### Highlights

- **macOS app links are clickable again.** Footer links (ICP / 公网安备 /
  slidestage.dev) now open in the user's default browser via
  `tauri-plugin-opener` instead of being swallowed by the WKWebView.
- **Official product name standardized.** Display name is now
  **"SlideStage Lite"** (and Pro counterpart is **"SlideStage Pro"**) —
  with a space, per branding decision. Bundle identifier, npm package
  names, repository name, and DMG filename remain unchanged so existing
  installs upgrade in place without losing locale, trust, or annotation
  state.
- **Self-distributed builds detect new versions.** A passive update
  banner polls GitHub Releases on launch; when a newer tag is found,
  the user sees a one-click link to the release page. Dismissed
  versions are remembered per tag in `localStorage`.
- **Window-scoped keyboard shortcuts.** The OS-level
  `tauri-plugin-global-shortcut` plugin was **removed**. Presentation
  keys now work via the existing `window.addEventListener('keydown', …)`
  layer, with focus reclaim triggered on iframe load, container
  pointerdown, and host-window refocus (Alt/Cmd-Tab back).
- **Mac App Store feasibility assessment** (`docs/MAC_APP_STORE_ASSESSMENT.md`)
  documents the remaining sandbox / library-validation blockers and
  the planned remediation path. The global-shortcut blocker is now
  resolved, leaving App Sandbox + library validation as the remaining
  large items. MAS submission is deferred per current direction.

### `@slidestage/lite-preset`

- **New:** `desktop/openExternal` — opens URLs in the OS browser via
  `tauri-plugin-opener` (Tauri-only), with a `withDesktopOpener(url)`
  React helper that intercepts anchor clicks in host UI.
- **New:** `desktop/updateCheck` — GitHub Releases poller with semver
  comparison (`v` prefix, pre-release skip, draft skip) and
  per-tag dismissal stored in `localStorage`.
- **New:** `app/UpdateBanner` — passive banner shown in the `deck-closed`
  shell; calls `openExternal` to route to the release page.
- **Removed:** `desktop/globalShortcuts` and the
  `@tauri-apps/plugin-global-shortcut` peer dependency. Window-scoped
  shortcuts handle the same surface (see `@slidestage/ui` notes below).
- i18n: `app.brand.name`, `viewer.notice.autoElevatedSize`,
  `trust.lead.before` updated to "SlideStage Lite"; new `update.body /
  cta / dismiss` keys for the banner (zh-CN + en).
- `audienceWindow.title` updated to `"SlideStage Lite — Audience"`.

### `@slidestage/ui`

- `DeckStage` gains a third focus-reclaim trigger: when the host
  `window` regains focus (Alt/Cmd-Tab back, dismissing a system
  dialog), focus is pulled back into the deck container so
  presentation shortcuts are available immediately. Previously this
  was papered over by global shortcuts; with that plugin gone, the
  reclaim is needed to keep window-scoped shortcuts feeling
  responsive.

### `@slidestage/core`

- Cosmetic: `converter/buildManifest` sniffer description string
  uses the new product name.

### Desktop

- `tauri.conf.json > productName` is now `"SlideStage Lite"`. The
  built bundle moves from `target/.../bundle/macos/SlideStageLite.app`
  to `target/.../bundle/macos/SlideStage Lite.app`. Release / smoke /
  signing scripts probe both paths so older artifacts on disk are
  still inspectable.
- Removed `tauri-plugin-global-shortcut` from `Cargo.toml`,
  `src-tauri/src/lib.rs`, and `capabilities/default.json`.
- DMG filename pattern is unchanged:
  `SlideStageLite-<version>-macOS-AppleSilicon.dmg`.
- Bundle identifier unchanged: `dev.slidestage.slidestagelite`.

### Documentation

- `README.md` / `README_cn.md` rebranded.
- `docs/MAC_APP_STORE_ASSESSMENT.md` published (feasibility-only, no
  code changes for MAS yet).
- `.memory/desktop-tauri.md` records the naming policy and the
  window-scoped shortcut decision.

---

## 0.1.0

Initial public release. See
[the v0.1.0 GitHub Release](https://github.com/SlideStage/SlideStageLite/releases/tag/v0.1.0)
for the introductory notes.

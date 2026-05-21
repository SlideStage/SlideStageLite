# SlideStage Lite — Changelog

All notable changes to the SlideStage Lite app and its `@slidestage/*`
packages live here. Per-package `CHANGELOG.md` files reference the
relevant sections of this file.

This project follows [Semantic Versioning](https://semver.org/). Until
1.0 the public API of every `@slidestage/*` package may evolve between
0.x minor releases; we will call out breaking changes explicitly.

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

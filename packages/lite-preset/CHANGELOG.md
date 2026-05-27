# @slidestage/lite-preset — Changelog

## 0.1.2

### Patch Changes

- Updated dependencies [5468558]
  - @slidestage/ui@0.1.2
  - @slidestage/core@0.1.2

See the root [`CHANGELOG.md`](../../CHANGELOG.md) of the SlideStage Lite
repository for the human-readable narrative of each release.

## 0.1.1 — 2026-05-21

### Added

- `desktop/openExternal` — opens URLs in the OS browser via
  `tauri-plugin-opener` when running inside Tauri, with a fallback
  `window.open` for browser builds. Includes a `withDesktopOpener(url)`
  React helper that intercepts anchor clicks in host UI (Footer etc.)
  so the macOS WKWebView doesn't swallow them.
- `desktop/updateCheck` — polls `api.github.com/repos/<owner>/<repo>/releases/latest`,
  compares the published tag against the current app version (semver
  with `v` prefix tolerance + pre-release / draft skipping), and
  persists per-tag dismissal in `localStorage`. Self-distributed
  builds only — packaged stores should suppress via a build flag.
- `app/UpdateBanner` — passive banner rendered in the `deck-closed`
  shell that surfaces the update check result. The CTA opens the
  release page via `openExternal` instead of navigating away.
- i18n: new keys `update.body`, `update.cta`, `update.dismiss` in
  zh-CN and en.

### Changed

- `app.brand.name`, `viewer.notice.autoElevatedSize`, and
  `trust.lead.before` i18n keys updated to read "SlideStage Lite"
  (with a space).
- `audienceWindow.ts`: window title is now `"SlideStage Lite — Audience"`.

### Removed

- `desktop/globalShortcuts` module and the
  `@tauri-apps/plugin-global-shortcut` peer dependency (and its
  `peerDependenciesMeta` entry). Presentation keys now flow through
  the existing `window.addEventListener('keydown', …)` layer in
  `LiteApp.tsx` and the focus-reclaim helpers in `@slidestage/ui`'s
  `DeckStage`. Removing the OS-level global hook also removes a
  prospective Mac App Store entitlement we'd rather not request.

## 0.1.0

- Initial publication of the default Lite feature preset (app shell,
  i18n, persistence, desktop adapters).

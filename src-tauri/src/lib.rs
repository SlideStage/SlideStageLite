use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::menu::MenuItemKind;
use tauri::{AppHandle, Emitter, Manager};
#[cfg(target_os = "macos")]
use tauri::RunEvent;

/// Queue of `.stage` paths captured BEFORE the front-end is ready to
/// listen. We drain this from JS via `opened_urls` on boot, and we keep
/// pushing while the queue is non-empty so cold-start + warm path use
/// the same machinery.
///
/// macOS specifics: when the user double-clicks a `.stage` from Finder
/// the OS uses `application:openURLs:`, which Tauri 2 surfaces as
/// `RunEvent::Opened { urls }`. `std::env::args()` is NOT populated for
/// this flow on macOS, so we must rely on the run-event callback.
/// `single-instance` is still wired as a belt-and-braces fallback for
/// the case where the user opens a second file while we're already up.
#[derive(Default)]
struct PendingFiles(Mutex<Vec<String>>);

/// Canonical paths of `.stage` files the app itself surfaced (Finder
/// open, argv, single-instance, macOS `RunEvent::Opened`). `read_deck_bytes`
/// only reads paths in this set, so a compromised / same-origin renderer
/// cannot turn the command into an arbitrary local-file read (DSS-CAND-002).
#[derive(Default)]
struct AllowedDeckPaths(Mutex<HashSet<PathBuf>>);

/// Raised by the front-end (`set_unsaved_edits`) while the open deck has
/// text edits that were not exported to a `.stage` copy yet. The custom
/// `quit` menu item (macOS App menu / Cmd+Q) consults it: when raised,
/// quitting is deferred to the front-end (`app:confirm-quit`) so a native
/// ask-dialog can confirm; when down, the app exits immediately without a
/// JS round-trip. Window close is guarded separately in JS through the
/// close-requested event.
#[derive(Default)]
struct UnsavedEdits(AtomicBool);

/// True when `path` ends in a case-insensitive `.stage` extension.
fn has_stage_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("stage"))
        .unwrap_or(false)
}

/// Validate a renderer-supplied path against the allow-list. Returns the
/// canonical path to read, or an error describing why it was refused.
///
/// Enforced invariants:
/// - extension must be `.stage` (case-insensitive),
/// - the path must canonicalize (exists; symlinks resolved to their target),
/// - the canonical path must be one the app previously surfaced.
fn resolve_allowed_read(
    path: &str,
    allowed: &HashSet<PathBuf>,
) -> Result<PathBuf, String> {
    let candidate = Path::new(path);
    if !has_stage_extension(candidate) {
        return Err("refused: not a .stage file".to_string());
    }
    let canonical = std::fs::canonicalize(candidate)
        .map_err(|e| format!("failed to resolve {path}: {e}"))?;
    if !allowed.contains(&canonical) {
        return Err(format!("refused: {path} was not opened through SlideStage"));
    }
    Ok(canonical)
}

/// Record a path the app surfaced so a later `read_deck_bytes` can read it.
/// Returns `false` (and registers nothing) for non-`.stage` paths or paths
/// that do not resolve to an existing file.
fn register_allowed_deck_path(app: &AppHandle, path: &str) -> bool {
    let candidate = Path::new(path);
    if !has_stage_extension(candidate) {
        return false;
    }
    let Ok(canonical) = std::fs::canonicalize(candidate) else {
        return false;
    };
    if !canonical.is_file() {
        return false;
    }
    match app.state::<AllowedDeckPaths>().0.lock() {
        Ok(mut set) => {
            set.insert(canonical);
            true
        }
        Err(_) => false,
    }
}

/// Metadata about a single connected display, surfaced to the front-end
/// so the user can pick which monitor the audience window should
/// fullscreen onto.
///
/// `id` is the index into `availableMonitors()` ordering, which is
/// stable for the lifetime of the OS session and is what we round-trip
/// back to JS to place the new window.
#[derive(Debug, Clone, Serialize)]
struct MonitorInfo {
    id: usize,
    name: String,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    scale_factor: f64,
    is_primary: bool,
}

/// Read the bytes of a `.stage` (zip) file from disk.
///
/// We deliberately keep this in Rust (instead of letting the front-end
/// fetch the path directly) so the capability ACL in
/// `capabilities/default.json` gates *who* can call it, while the
/// allow-list below gates *which paths* it can read. The path must:
///   1. end in `.stage`,
///   2. resolve to an existing file, and
///   3. be a path the app itself surfaced (Finder open / argv /
///      `RunEvent::Opened`) — see `AllowedDeckPaths`.
/// This prevents a compromised or same-origin renderer from reading
/// arbitrary local files such as `/etc/passwd` (DSS-CAND-002).
#[tauri::command]
async fn read_deck_bytes(app: AppHandle, path: String) -> Result<Vec<u8>, String> {
    let canonical = {
        let state = app.state::<AllowedDeckPaths>();
        let allowed = state
            .0
            .lock()
            .map_err(|_| "deck allow-list lock poisoned".to_string())?;
        resolve_allowed_read(&path, &allowed)?
    };
    std::fs::read(&canonical).map_err(|e| format!("failed to read {}: {}", path, e))
}

/// Mirror of the front-end's "unexported edits exist" flag — see
/// [`UnsavedEdits`]. Called whenever the flag changes and lowered again
/// when the deck viewer unmounts.
#[tauri::command]
fn set_unsaved_edits(app: AppHandle, unsaved: bool) {
    app.state::<UnsavedEdits>().0.store(unsaved, Ordering::SeqCst);
}

/// Drain the in-memory queue of `.stage` paths that arrived before the
/// front-end attached its listener. Returns at most a few entries — if
/// the user double-clicks ten files we still want every one.
#[tauri::command]
fn opened_urls(app: AppHandle) -> Vec<String> {
    app.state::<PendingFiles>()
        .0
        .lock()
        .map(|mut v| std::mem::take(&mut *v))
        .unwrap_or_default()
}

/// Back-compat alias for the older single-path API. Returns the most
/// recent pending path, if any, and removes it from the queue. Kept so
/// the front-end can be rolled out in either order without breaking.
#[tauri::command]
fn pending_file(app: AppHandle) -> Option<String> {
    let state = app.state::<PendingFiles>();
    let mut guard = state.0.lock().ok()?;
    if guard.is_empty() {
        None
    } else {
        Some(guard.remove(0))
    }
}

/// Enumerate all attached monitors. The first one whose origin is
/// `(0, 0)` is reported as the primary (matches the macOS / Wayland /
/// Win32 convention).
#[tauri::command]
fn list_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not yet created".to_string())?;
    let monitors = win
        .available_monitors()
        .map_err(|e| format!("available_monitors failed: {e}"))?;
    let out = monitors
        .into_iter()
        .enumerate()
        .map(|(idx, m)| {
            let pos = m.position();
            let size = m.size();
            MonitorInfo {
                id: idx,
                name: m.name().cloned().unwrap_or_else(|| format!("Display {idx}")),
                width: size.width,
                height: size.height,
                x: pos.x,
                y: pos.y,
                scale_factor: m.scale_factor(),
                is_primary: pos.x == 0 && pos.y == 0,
            }
        })
        .collect();
    Ok(out)
}

/// ---------- Thumbnail side-car cache ----------
///
/// The first time a deck is opened on desktop, the front-end captures a
/// 480×270 WebP for every slide and asks Rust to persist it under
///   <APP_DATA>/thumbnails/<fingerprint>/<slide_id>.webp
///
/// fingerprint is the 64-char SHA-256 hex of the deck bytes (computed by
/// the loader) — it changes whenever the deck contents change, so cache
/// entries are naturally version-isolated. slide_id matches
/// `manifest.slides[].id` (validated against `[A-Za-z0-9._-]` to keep the
/// on-disk path safe).
///
/// We keep this in Rust (rather than letting the front-end touch the FS
/// directly) so capability ACL stays the single source of truth for FS
/// access and so the path-traversal guard below is enforceable.
fn fingerprint_ok(fingerprint: &str) -> bool {
    !fingerprint.is_empty()
        && fingerprint.len() <= 128
        && fingerprint
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn slide_id_ok(slide_id: &str) -> bool {
    !slide_id.is_empty()
        && slide_id.len() <= 128
        && slide_id.bytes().all(|b| {
            b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.'
        })
        && slide_id != "."
        && slide_id != ".."
}

fn thumbnails_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir unavailable: {e}"))?;
    Ok(base.join("thumbnails"))
}

fn deck_cache_dir(app: &AppHandle, fingerprint: &str) -> Result<PathBuf, String> {
    if !fingerprint_ok(fingerprint) {
        return Err("invalid fingerprint".to_string());
    }
    Ok(thumbnails_root(app)?.join(fingerprint))
}

/// Per-entry hard cap. A single 480×270 WebP should land well under 40 KB;
/// anything bigger means something is wrong upstream.
const MAX_THUMBNAIL_BYTES: usize = 256 * 1024;

/// Per-deck thumbnail count cap (DSS-CAND-017). A legitimate deck stores
/// one thumbnail per slide and stays far below this; the cap bounds a
/// malicious renderer that floods `thumbnail_cache_put` with distinct
/// `slide_id`s to grow a single deck dir without limit.
const MAX_THUMBNAILS_PER_DECK: usize = 4000;

/// Global byte budget across every deck's thumbnails (DSS-CAND-017).
/// Oldest-first eviction keeps total on-disk usage bounded even as many
/// decks are opened over the app's lifetime.
const MAX_TOTAL_CACHE_BYTES: u64 = 256 * 1024 * 1024;

/// Collect `(path, modified_time, size)` for every `*.webp` file directly
/// inside `dir`. Missing dirs / unreadable entries are skipped rather than
/// erroring — eviction is best-effort housekeeping.
fn collect_webp_entries(dir: &Path) -> Vec<(PathBuf, std::time::SystemTime, u64)> {
    let mut out = Vec::new();
    let Ok(read) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in read.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("webp") {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let modified = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
        out.push((path, modified, meta.len()));
    }
    out
}

/// Evict oldest thumbnails in a single deck dir until at most `max` remain.
fn evict_deck_to_count(dir: &Path, max: usize) {
    let mut entries = collect_webp_entries(dir);
    if entries.len() <= max {
        return;
    }
    entries.sort_by_key(|(_, modified, _)| *modified); // oldest first
    let remove_n = entries.len() - max;
    for (path, _, _) in entries.into_iter().take(remove_n) {
        let _ = std::fs::remove_file(path);
    }
}

/// Evict oldest thumbnails across every deck dir under `root` until the
/// total size is within `budget`.
fn evict_global_to_budget(root: &Path, budget: u64) {
    let Ok(read) = std::fs::read_dir(root) else {
        return;
    };
    let mut all: Vec<(PathBuf, std::time::SystemTime, u64)> = Vec::new();
    for deck in read.flatten() {
        let p = deck.path();
        if p.is_dir() {
            all.extend(collect_webp_entries(&p));
        }
    }
    let mut total: u64 = all.iter().map(|(_, _, size)| *size).sum();
    if total <= budget {
        return;
    }
    all.sort_by_key(|(_, modified, _)| *modified); // oldest first
    for (path, _, size) in all {
        if total <= budget {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
}

#[tauri::command]
fn thumbnail_cache_get(
    app: AppHandle,
    fingerprint: String,
    slide_id: String,
) -> Result<Option<Vec<u8>>, String> {
    if !slide_id_ok(&slide_id) {
        return Err("invalid slide_id".to_string());
    }
    let path = deck_cache_dir(&app, &fingerprint)?.join(format!("{slide_id}.webp"));
    match std::fs::read(&path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("failed to read cached thumbnail: {err}")),
    }
}

#[tauri::command]
fn thumbnail_cache_put(
    app: AppHandle,
    fingerprint: String,
    slide_id: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    if !slide_id_ok(&slide_id) {
        return Err("invalid slide_id".to_string());
    }
    // Per-entry hard cap — a single 480×270 WebP should land under 40 KB; a
    // big buffer here means something is wrong upstream and we'd rather
    // bail than fill the user's disk.
    if bytes.len() > MAX_THUMBNAIL_BYTES {
        return Err("thumbnail too large".to_string());
    }
    let dir = deck_cache_dir(&app, &fingerprint)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create thumbnail dir: {e}"))?;
    let path = dir.join(format!("{slide_id}.webp"));
    std::fs::write(&path, &bytes)
        .map_err(|e| format!("failed to write thumbnail: {e}"))?;
    // DSS-CAND-017: bound disk usage. Per-entry size alone does not stop a
    // malicious renderer from flooding put() with distinct slide_ids (one
    // deck) or churning many decks (global). Enforce a per-deck count cap
    // and a global byte budget with oldest-first eviction after each write.
    evict_deck_to_count(&dir, MAX_THUMBNAILS_PER_DECK);
    if let Ok(root) = thumbnails_root(&app) {
        evict_global_to_budget(&root, MAX_TOTAL_CACHE_BYTES);
    }
    Ok(())
}

#[tauri::command]
fn thumbnail_cache_list(
    app: AppHandle,
    fingerprint: String,
) -> Result<Vec<String>, String> {
    let dir = deck_cache_dir(&app, &fingerprint)?;
    let read = match std::fs::read_dir(&dir) {
        Ok(r) => r,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(format!("failed to list thumbnail dir: {err}")),
    };
    let mut ids = Vec::new();
    for entry in read.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            if let Some(stem) = name.strip_suffix(".webp") {
                if slide_id_ok(stem) {
                    ids.push(stem.to_string());
                }
            }
        }
    }
    Ok(ids)
}

#[tauri::command]
fn thumbnail_cache_clear(
    app: AppHandle,
    fingerprint: String,
) -> Result<(), String> {
    let dir = deck_cache_dir(&app, &fingerprint)?;
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("failed to clear thumbnail cache: {err}")),
    }
}

/// Toggle the menu-bar "Check for Updates…" item between its idle state
/// and the in-flight "Checking for Updates…" state. The front-end calls
/// this around the manual update probe driven by the menu trigger so the
/// user gets immediate visual feedback in the same place they clicked.
///
/// No-op when the menu / item is missing — keeps the front-end code path
/// platform-agnostic. On macOS the item sits directly under the App
/// submenu (top-level after `menu.get`); on Windows the item is nested
/// inside `Help`, so we fall back to one level of submenu recursion.
/// `Menu::get` / `Submenu::get` are NOT recursive in Tauri 2 — this is
/// the documented contract, and a flat get-by-id is silently None when
/// the target lives inside a submenu.
#[tauri::command]
fn set_check_update_menu_state(app: AppHandle, checking: bool) -> Result<(), String> {
    let Some(menu) = app.menu() else { return Ok(()); };

    let text_item = match menu.get("check_updates") {
        Some(MenuItemKind::MenuItem(item)) => Some(item),
        _ => menu
            .items()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|kind| {
                let MenuItemKind::Submenu(sub) = kind else { return None };
                match sub.get("check_updates") {
                    Some(MenuItemKind::MenuItem(item)) => Some(item),
                    _ => None,
                }
            })
            .next(),
    };

    let Some(text_item) = text_item else { return Ok(()); };

    let (text, enabled) = if checking {
        ("Checking for Updates…", false)
    } else {
        ("Check for Updates…", true)
    };

    text_item
        .set_text(text)
        .map_err(|e| format!("set_text failed: {e}"))?;
    text_item
        .set_enabled(enabled)
        .map_err(|e| format!("set_enabled failed: {e}"))?;
    Ok(())
}

fn handle_opened_path(app: &AppHandle, path: String) {
    // Only surface real, existing `.stage` files, and remember the
    // canonical path so `read_deck_bytes` can scope its reads to files the
    // user actually opened (DSS-CAND-002). Anything else is ignored.
    if !register_allowed_deck_path(app, &path) {
        eprintln!("ignoring open path (not an existing .stage file): {path}");
        return;
    }
    if let Ok(mut slot) = app.state::<PendingFiles>().0.lock() {
        slot.push(path.clone());
    }
    if let Err(err) = app.emit("deck:open", &path) {
        eprintln!("deck:open emit failed (queued for drain): {err}");
    }
    if let Err(err) = app.emit("opened", vec![path]) {
        eprintln!("opened emit failed: {err}");
    }
}

fn ingest_argv(app: &AppHandle, argv: &[String]) {
    for arg in argv.iter().skip(1) {
        let p = std::path::Path::new(arg);
        if p.exists() && p.extension().and_then(|s| s.to_str()) == Some("stage") {
            handle_opened_path(app, arg.clone());
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            ingest_argv(app, &argv);
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        // Updater + process: desktop-only. Registered before the dialog
        // listeners so the front-end can call `check()` / `relaunch()`
        // immediately after the window is created. We deliberately do
        // NOT trigger any auto-check from Rust — the JS layer owns the
        // policy (silent at boot, surface a banner only when there is a
        // genuine new version available).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(PendingFiles::default())
        .manage(AllowedDeckPaths::default())
        .manage(UnsavedEdits::default())
        .setup(|app| {
            // Windows / Linux: file path arrives via argv. macOS uses
            // RunEvent::Opened (handled below in the .run callback).
            ingest_argv(&app.handle(), &std::env::args().collect::<Vec<_>>());

            // macOS: rebuild the App submenu so the standard
            //   About | --- | Check for Updates… | --- | Services | --- |
            //   Hide | Hide Others | Show All | --- | Quit
            // structure (Safari / Xcode / Sparkle convention) is in
            // place. We do this in Rust because the macOS application
            // menu is OS-owned and unreachable from the WebView.
            //
            // The Edit / View / Window / Help submenus produced by
            // Menu::default are preserved by only swapping out item[0]
            // (the App submenu).
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

                let handle = app.handle();

                let about = PredefinedMenuItem::about(handle, None, None)?;
                let check_updates = MenuItem::with_id(
                    handle,
                    "check_updates",
                    "Check for Updates…",
                    true,
                    None::<&str>,
                )?;
                let sep_a = PredefinedMenuItem::separator(handle)?;
                let sep_b = PredefinedMenuItem::separator(handle)?;
                let services = PredefinedMenuItem::services(handle, None)?;
                let sep_c = PredefinedMenuItem::separator(handle)?;
                let hide = PredefinedMenuItem::hide(handle, None)?;
                let hide_others = PredefinedMenuItem::hide_others(handle, None)?;
                let show_all = PredefinedMenuItem::show_all(handle, None)?;
                let sep_d = PredefinedMenuItem::separator(handle)?;
                // Custom item instead of PredefinedMenuItem::quit: the
                // predefined one sends `terminate:` straight to NSApp,
                // which tao cannot intercept, so an unsaved-edits
                // confirmation would be impossible. This item routes
                // through on_menu_event below where the UnsavedEdits
                // flag decides between exiting and asking the front-end
                // to confirm first.
                let quit = MenuItem::with_id(
                    handle,
                    "quit",
                    "Quit SlideStage Lite",
                    true,
                    Some("CmdOrCtrl+Q"),
                )?;

                let app_submenu = Submenu::with_id_and_items(
                    handle,
                    "app",
                    "SlideStage Lite",
                    true,
                    &[
                        &about,
                        &sep_a,
                        &check_updates,
                        &sep_b,
                        &services,
                        &sep_c,
                        &hide,
                        &hide_others,
                        &show_all,
                        &sep_d,
                        &quit,
                    ],
                )?;

                let menu = Menu::default(handle)?;
                menu.remove_at(0)?;
                menu.insert(&app_submenu, 0)?;
                app.set_menu(menu)?;
            }

            // Windows: attach a window menu bar with a single Help
            // submenu so we have a stable, discoverable entry point for
            // "Check for Updates…" and "About". Windows has no
            // equivalent of the macOS application menu, but the
            // per-window menu bar shows at the top of the main window
            // and is the convention used by VS Code, Slack, Discord.
            //
            // We reuse the same menu item id (`check_updates`) and the
            // same Rust-side toggle command (`set_check_update_menu_state`)
            // as macOS so the front-end's `runManualUpdateCheck` flow
            // and the `menu:check-update` event handler work unchanged
            // — `set_check_update_menu_state` recurses one level into
            // submenus so the nested-under-Help layout still resolves.
            //
            // Help → About SlideStage Lite uses `PredefinedMenuItem::about`
            // which on Windows pops a native dialog assembled from the
            // metadata below (name, version, copyright, website). That
            // mirrors the macOS About dialog driven by the App menu's
            // `PredefinedMenuItem::about` so users see the same level of
            // information on both OSes.
            #[cfg(target_os = "windows")]
            {
                use tauri::menu::{
                    AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu,
                };

                let handle = app.handle();
                let check_updates = MenuItem::with_id(
                    handle,
                    "check_updates",
                    "Check for Updates…",
                    true,
                    None::<&str>,
                )?;
                let sep = PredefinedMenuItem::separator(handle)?;
                let about_metadata = AboutMetadata {
                    name: Some("SlideStage Lite".to_string()),
                    version: Some(env!("CARGO_PKG_VERSION").to_string()),
                    copyright: Some("© 2026 SlideStage".to_string()),
                    website: Some("https://slidestage.dev".to_string()),
                    website_label: Some("slidestage.dev".to_string()),
                    ..Default::default()
                };
                let about = PredefinedMenuItem::about(
                    handle,
                    Some("About SlideStage Lite"),
                    Some(about_metadata),
                )?;
                let help = Submenu::with_id_and_items(
                    handle,
                    "help",
                    "Help",
                    true,
                    &[&check_updates, &sep, &about],
                )?;
                let menu = Menu::with_items(handle, &[&help])?;
                app.set_menu(menu)?;
            }

            // Windows / Linux: register the `stage://` deep-link scheme
            // at runtime as a defensive fallback. Tauri's NSIS template
            // also writes the protocol registry keys at install time
            // (see `bundle.deepLinkSchemes`), but there is a historic
            // Tauri issue (#10095) where the NSIS path silently no-ops
            // depending on installer settings; calling `register_all`
            // here makes the scheme available the first time the app
            // launches regardless of how it was installed. The call
            // requires no admin rights — it writes under HKCU.
            // No-op on macOS where `RunEvent::Opened` is the canonical
            // path and the scheme is declared in `Info.plist`.
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(err) = app.deep_link().register_all() {
                    eprintln!("deep_link register_all failed: {err}");
                }
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            // Single global handler so future menu items (Help >
            // Documentation, etc.) plug in without re-touching the
            // builder. We forward to the front-end rather than acting
            // on the updater directly because the JS layer owns the
            // policy (locale-aware dialog text, dismiss flow, etc.).
            if event.id().as_ref() == "check_updates" {
                if let Err(err) = app.emit("menu:check-update", ()) {
                    eprintln!("failed to emit menu:check-update: {err}");
                }
            }
            if event.id().as_ref() == "quit" {
                let unsaved = app.state::<UnsavedEdits>().0.load(Ordering::SeqCst);
                if unsaved {
                    // Defer to the front-end for a locale-aware confirm
                    // dialog. If the emit fails there is no listener to
                    // ask — exit rather than trapping the user.
                    if let Err(err) = app.emit("app:confirm-quit", ()) {
                        eprintln!("failed to emit app:confirm-quit: {err}");
                        app.exit(0);
                    }
                } else {
                    app.exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            read_deck_bytes,
            pending_file,
            opened_urls,
            list_monitors,
            thumbnail_cache_get,
            thumbnail_cache_put,
            thumbnail_cache_list,
            thumbnail_cache_clear,
            set_check_update_menu_state,
            set_unsaved_edits,
        ])
        .build(tauri::generate_context!())
        .expect("error while building SlideStage Lite Desktop");

    app.run(|_app, _event| {
        // RunEvent::Opened is a macOS-only variant — Tauri's enum drops
        // the variant on Windows/Linux entirely, so a plain pattern match
        // fails to compile. On Windows the `.stage` open-path is argv
        // (handled in `setup()` via ingest_argv) plus the runtime
        // deep-link fallback, so this closure has nothing to do here.
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = _event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    if let Some(s) = path.to_str() {
                        handle_opened_path(_app, s.to_string());
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn stage_extension_is_detected_case_insensitively() {
        assert!(has_stage_extension(Path::new("/decks/talk.stage")));
        assert!(has_stage_extension(Path::new("/decks/TALK.STAGE")));
        assert!(has_stage_extension(Path::new("/decks/Talk.Stage")));
        assert!(!has_stage_extension(Path::new("/decks/talk.zip")));
        assert!(!has_stage_extension(Path::new("/etc/passwd")));
        assert!(!has_stage_extension(Path::new("/decks/stage")));
        assert!(!has_stage_extension(Path::new("/decks/talk.stage.bak")));
    }

    #[test]
    fn resolve_allowed_read_enforces_extension_existence_and_allowlist() {
        let dir = std::env::temp_dir().join(format!(
            "slidestage-read-scope-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();

        let deck = dir.join("authorized.stage");
        fs::write(&deck, b"PK\x03\x04").unwrap();
        let secret = dir.join("secret.stage");
        fs::write(&secret, b"top secret").unwrap();
        let note = dir.join("passwd.txt");
        fs::write(&note, b"root:x:0:0").unwrap();

        let mut allowed = HashSet::new();
        allowed.insert(fs::canonicalize(&deck).unwrap());

        // Authorized `.stage` resolves to its canonical path.
        let ok = resolve_allowed_read(deck.to_str().unwrap(), &allowed);
        assert_eq!(ok.unwrap(), fs::canonicalize(&deck).unwrap());

        // A `.stage` that exists but was never surfaced is refused.
        assert!(resolve_allowed_read(secret.to_str().unwrap(), &allowed).is_err());

        // A non-`.stage` path is refused even if we lie and add it to the set.
        allowed.insert(fs::canonicalize(&note).unwrap());
        assert!(resolve_allowed_read(note.to_str().unwrap(), &allowed).is_err());

        // A path that does not exist is refused (canonicalize fails).
        let missing = dir.join("ghost.stage");
        assert!(resolve_allowed_read(missing.to_str().unwrap(), &allowed).is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    fn unique_tmp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "slidestage-{tag}-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Write a webp file with a deterministic modified-time so eviction
    /// ordering is reproducible regardless of filesystem mtime resolution.
    fn write_webp_at(dir: &Path, name: &str, size: usize, modified: std::time::SystemTime) {
        let path = dir.join(format!("{name}.webp"));
        fs::write(&path, vec![0u8; size]).unwrap();
        let file = fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_modified(modified).unwrap();
    }

    fn at(secs: u64) -> std::time::SystemTime {
        std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs)
    }

    #[test]
    fn evict_deck_to_count_removes_oldest_beyond_cap() {
        let dir = unique_tmp_dir("evict-deck");
        // 5 entries, ages 100..104 (oldest = "s0").
        for i in 0..5u64 {
            write_webp_at(&dir, &format!("s{i}"), 16, at(100 + i));
        }

        evict_deck_to_count(&dir, 3);

        let remaining: HashSet<String> = collect_webp_entries(&dir)
            .into_iter()
            .filter_map(|(p, _, _)| {
                p.file_stem().and_then(|s| s.to_str()).map(|s| s.to_string())
            })
            .collect();
        // The two oldest (s0, s1) are gone; the three newest survive.
        assert_eq!(remaining.len(), 3);
        assert!(!remaining.contains("s0"));
        assert!(!remaining.contains("s1"));
        assert!(remaining.contains("s2"));
        assert!(remaining.contains("s3"));
        assert!(remaining.contains("s4"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn evict_deck_to_count_keeps_everything_within_cap() {
        let dir = unique_tmp_dir("evict-deck-noop");
        for i in 0..3u64 {
            write_webp_at(&dir, &format!("s{i}"), 16, at(100 + i));
        }
        evict_deck_to_count(&dir, 10);
        assert_eq!(collect_webp_entries(&dir).len(), 3);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn evict_global_to_budget_trims_oldest_across_decks() {
        let root = unique_tmp_dir("evict-global");
        let deck_a = root.join("aaaa");
        let deck_b = root.join("bbbb");
        fs::create_dir_all(&deck_a).unwrap();
        fs::create_dir_all(&deck_b).unwrap();

        // 1000 bytes total across two decks; oldest is deck_a/old.
        write_webp_at(&deck_a, "old", 400, at(10));
        write_webp_at(&deck_b, "mid", 300, at(20));
        write_webp_at(&deck_b, "new", 300, at(30));

        // Budget 600 → must drop the oldest (400) to reach 600.
        evict_global_to_budget(&root, 600);

        let a = collect_webp_entries(&deck_a);
        let b = collect_webp_entries(&deck_b);
        let total: u64 = a
            .iter()
            .chain(b.iter())
            .map(|(_, _, size)| *size)
            .sum();
        assert!(total <= 600, "total {total} should be within budget");
        // The oldest entry (deck_a/old) is the one evicted.
        assert!(a.is_empty());
        assert_eq!(b.len(), 2);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn evict_global_to_budget_is_noop_within_budget() {
        let root = unique_tmp_dir("evict-global-noop");
        let deck = root.join("cccc");
        fs::create_dir_all(&deck).unwrap();
        write_webp_at(&deck, "s0", 100, at(10));
        write_webp_at(&deck, "s1", 100, at(20));

        evict_global_to_budget(&root, 10_000);
        assert_eq!(collect_webp_entries(&deck).len(), 2);
        let _ = fs::remove_dir_all(&root);
    }
}

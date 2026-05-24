use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::menu::MenuItemKind;
use tauri::{AppHandle, Emitter, Manager, RunEvent};

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
/// `capabilities/default.json` can scope-gate it.
#[tauri::command]
async fn read_deck_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("failed to read {}: {}", path, e))
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
    // 256 KB hard cap — a single 480×270 WebP should land under 40 KB; a
    // big buffer here means something is wrong upstream and we'd rather
    // bail than fill the user's disk.
    if bytes.len() > 256 * 1024 {
        return Err("thumbnail too large".to_string());
    }
    let dir = deck_cache_dir(&app, &fingerprint)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create thumbnail dir: {e}"))?;
    let path = dir.join(format!("{slide_id}.webp"));
    std::fs::write(&path, &bytes)
        .map_err(|e| format!("failed to write thumbnail: {e}"))?;
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
                let quit = PredefinedMenuItem::quit(handle, None)?;

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
        ])
        .build(tauri::generate_context!())
        .expect("error while building SlideStage Lite Desktop");

    app.run(|app, event| {
        if let RunEvent::Opened { urls } = event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    if let Some(s) = path.to_str() {
                        handle_opened_path(app, s.to_string());
                    }
                }
            }
        }
    });
}

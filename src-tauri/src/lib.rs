use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
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
            Ok(())
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

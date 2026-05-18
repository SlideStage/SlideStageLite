use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Holds the path of a `.hcslides` file that the user double-clicked
/// (or that arrived via deep-link) BEFORE the front-end was ready to listen.
///
/// On startup the front-end calls `pending_file` to drain this queue.
#[derive(Default)]
struct PendingFile(Mutex<Option<String>>);

/// Read the bytes of a `.hcslides` (zip) file from disk.
///
/// We deliberately keep this in Rust (instead of letting the front-end
/// fetch the path directly) so the capability ACL in
/// `capabilities/default.json` can scope-gate it.
#[tauri::command]
async fn read_deck_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("failed to read {}: {}", path, e))
}

/// Drain any file path that was deferred while the front-end was booting.
#[tauri::command]
fn pending_file(app: AppHandle) -> Option<String> {
    app.state::<PendingFile>().0.lock().ok()?.take()
}

fn handle_opened_file(app: &AppHandle, path: String) {
    if let Err(err) = app.emit("deck:open", &path) {
        eprintln!("deck:open emit failed, falling back to pending queue: {err}");
        if let Ok(mut slot) = app.state::<PendingFile>().0.lock() {
            *slot = Some(path);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            for arg in argv.iter().skip(1) {
                let p = std::path::Path::new(arg);
                if p.exists() {
                    handle_opened_file(app, arg.clone());
                }
            }
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(PendingFile::default())
        .setup(|app| {
            for arg in std::env::args().skip(1) {
                let p = std::path::Path::new(&arg);
                if p.exists() && p.extension().and_then(|s| s.to_str()) == Some("hcslides") {
                    if let Ok(mut slot) = app.state::<PendingFile>().0.lock() {
                        *slot = Some(arg);
                    }
                }
            }
            // Devtools temporarily disabled while debugging the white-window
            // boot path — re-enable once main webview is healthy.
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![read_deck_bytes, pending_file])
        .run(tauri::generate_context!())
        .expect("error while running SlidesDeckLite Desktop");
}

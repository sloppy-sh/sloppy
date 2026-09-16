mod history;
mod vault;

use tauri::{Manager, Runtime};

/// The whole of what this shell answers: `Files` and `History` in
/// `@sloppy/local`, which declare every one of them and what its answer means.
pub(crate) fn commands<R: Runtime>(
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        vault::files_read,
        vault::files_write,
        vault::files_list,
        vault::files_remove,
        vault::files_exists,
        vault::files_mkdir,
        vault::app_data_path,
        vault::pick_folder,
        vault::pick_file,
        vault::save_file,
        history::history_status,
        history::history_log,
        history::history_commit,
        history::history_branches,
        history::history_branch,
        history::history_switch,
        history::history_merge,
        history::history_resolve,
        history::history_read_at,
        history::history_head,
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // First plugin registered on desktop, so a second launch (the OS opening a
    // sloppy:// link) forwards the URL into the running process rather than
    // starting another one beside it.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {}));
    }

    // Asking for a folder or a file happens in `vault.rs` rather than on the
    // page, so the webview is never handed the dialog itself; `fs` is there for
    // what a person picks on Android, which is a content URI and not a path.
    let builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init());

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_safe_area_insets_css::init());

    builder
        .invoke_handler(commands())
        // How a picture in a graph loads on the page: one scheme, bounded by
        // the folders somebody picked.
        .register_asynchronous_uri_scheme_protocol(vault::SCHEME, vault::protocol)
        .setup(|app| {
            app.manage(vault::Folders::new(app.path().app_data_dir()?)?);

            // A custom scheme only fires for an installed app: iOS and Android
            // take it from the generated manifests and macOS from the bundled
            // .app, but Windows and Linux need it registered at runtime.
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

mod chat;
mod documenting;
mod history;
mod program;
mod remotes;
mod signing;
mod tools;
mod vault;

use tauri::{Manager, Runtime};

/// The whole of what this shell answers: `Files` and `History` in
/// `@sloppy/local` and `DocumentingAccess` and `ChatAccess` in
/// `@sloppy/app-core`, which declare every one of them and what its answer
/// means.
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
        history::history_changed_since,
        history::history_graph,
        history::history_branch_at,
        history::history_delete_branch,
        history::history_git_user,
        history::history_set_git_user,
        history::history_signing,
        history::history_set_signing,
        remotes::history_remotes,
        remotes::history_add_remote,
        remotes::history_rename_remote,
        remotes::history_set_remote_url,
        remotes::history_remove_remote,
        remotes::history_fetch,
        remotes::history_pull,
        remotes::history_push,
        remotes::files_clone,
        documenting::documenting_tools,
        documenting::documenting_ask,
        documenting::documenting_stop,
        chat::chat_agents,
        chat::chat_open,
        chat::chat_say,
        chat::chat_answer,
        chat::chat_close,
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
            app.manage(documenting::Running::default());
            app.manage(chat::Chat::default());

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

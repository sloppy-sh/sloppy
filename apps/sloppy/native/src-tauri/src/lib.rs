#[cfg(feature = "local-mode")]
mod db;

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

    let builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_safe_area_insets_css::init());

    #[cfg(feature = "local-mode")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        db::db_open,
        db::db_query,
        db::db_wipe
    ]);

    builder
        .setup(|_app| {
            // A custom scheme only fires for an installed app: iOS and Android
            // take it from the generated manifests and macOS from the bundled
            // .app, but Windows and Linux need it registered at runtime.
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                _app.deep_link().register_all()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

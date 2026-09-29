// The app's own menu bar. What it SAYS and what each line does is
// `menu.ts` in `@sloppy/app-core`; this builds what it is handed and carries
// the id of whatever was chosen back to the page, and reads neither.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

/// What the page is told when somebody chooses a line, carrying its id.
pub const CHOSEN: &str = "menu";

#[derive(serde::Deserialize)]
pub struct MenuLine {
    id: String,
    label: String,
    enabled: bool,
    accelerator: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct MenuGroup {
    label: String,
    lines: Vec<MenuLine>,
}

/// A line the system spells and does itself. `None` is an id this build has no
/// such line for, which is left out rather than refusing the whole menu.
fn its_own<R: Runtime>(app: &AppHandle<R>, id: &str) -> Option<PredefinedMenuItem<R>> {
    let made = match id {
        "~separator" => PredefinedMenuItem::separator(app),
        "~about" => PredefinedMenuItem::about(app, None, None),
        "~services" => PredefinedMenuItem::services(app, None),
        "~hide" => PredefinedMenuItem::hide(app, None),
        "~hide-others" => PredefinedMenuItem::hide_others(app, None),
        "~quit" => PredefinedMenuItem::quit(app, None),
        "~undo" => PredefinedMenuItem::undo(app, None),
        "~redo" => PredefinedMenuItem::redo(app, None),
        "~cut" => PredefinedMenuItem::cut(app, None),
        "~copy" => PredefinedMenuItem::copy(app, None),
        "~paste" => PredefinedMenuItem::paste(app, None),
        "~select-all" => PredefinedMenuItem::select_all(app, None),
        "~minimize" => PredefinedMenuItem::minimize(app, None),
        "~maximize" => PredefinedMenuItem::maximize(app, None),
        "~fullscreen" => PredefinedMenuItem::fullscreen(app, None),
        "~close" => PredefinedMenuItem::close_window(app, None),
        _ => return None,
    };
    made.ok()
}

#[tauri::command]
pub async fn app_menu_set<R: Runtime>(
    app: AppHandle<R>,
    groups: Vec<MenuGroup>,
) -> Result<(), String> {
    let menu = Menu::new(&app).map_err(|trouble| trouble.to_string())?;
    for group in &groups {
        let made = Submenu::new(&app, &group.label, true).map_err(|trouble| trouble.to_string())?;
        for line in &group.lines {
            if let Some(its) = its_own(&app, &line.id) {
                made.append(&its).map_err(|trouble| trouble.to_string())?;
                continue;
            }
            let item = MenuItem::with_id(
                &app,
                &line.id,
                &line.label,
                line.enabled,
                line.accelerator.as_deref(),
            )
            .map_err(|trouble| trouble.to_string())?;
            made.append(&item).map_err(|trouble| trouble.to_string())?;
        }
        menu.append(&made).map_err(|trouble| trouble.to_string())?;
    }
    app.set_menu(menu).map_err(|trouble| trouble.to_string())?;
    Ok(())
}

/// Carries the id of whatever was chosen to the page. A line the system does
/// itself never arrives here.
pub fn tell_the_page<R: Runtime>(app: &tauri::App<R>) {
    app.on_menu_event(|app, event| {
        let _ = app.emit(CHOSEN, event.id().0.clone());
    });
}

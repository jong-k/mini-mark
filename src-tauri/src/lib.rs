mod fs;
mod menu;
mod recent;
mod windows;

use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(windows::Windows::default()))
        .setup(|app| {
            let (menu, open_recent) = menu::build(app.handle())?;
            app.set_menu(menu)?;
            recent::setup(app.handle(), open_recent)?;
            Ok(())
        })
        .on_menu_event(menu::on_event)
        .invoke_handler(tauri::generate_handler![
            fs::read_markdown,
            fs::save_markdown_atomic,
            fs::save_asset,
            fs::file_modified_at,
            recent::add_recent_file,
            windows::take_opened_file,
            windows::set_document_state,
            windows::cancel_quit
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(windows::on_run_event);
}

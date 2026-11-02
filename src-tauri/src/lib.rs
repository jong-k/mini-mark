mod fs;
mod menu;
mod recent;
#[allow(dead_code)] // Task 3에서 Tauri에 연결한다
mod windows;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            recent::add_recent_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {});
}

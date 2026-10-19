mod fs;

use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 기본 메뉴의 Quit은 terminate:를 직접 호출해 CloseRequested를 건너뛴다. 창 닫기로 우회시킨다.
            let quit = MenuItemBuilder::with_id("quit", "Quit mini-mark")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;
            let app_menu = SubmenuBuilder::new(app, "mini-mark")
                .about(None)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .item(&quit)
                .build()?;
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .separator()
                .close_window()
                .build()?;
            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &edit_menu, &window_menu])
                .build()?;
            app.set_menu(menu)?;
            Ok(())
        })
        // ponytail: Dock 우클릭 종료와 로그아웃은 tao에 훅이 없어 가드를 타지 않는다. 필요하면 applicationShouldTerminate 처리 추가.
        .on_menu_event(|app, event| {
            if event.id() == "quit"
                && let Some(w) = app.get_webview_window("main")
            {
                let _ = w.close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            fs::read_markdown,
            fs::save_markdown_atomic,
            fs::save_asset
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

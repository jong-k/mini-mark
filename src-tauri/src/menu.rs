use tauri::menu::{Menu, MenuBuilder, MenuEvent, MenuItemBuilder, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::recent::{self, RecentFiles};

/// 메뉴를 만들고 Open Recent 서브메뉴 핸들을 함께 돌려준다.
pub fn build(app: &AppHandle) -> tauri::Result<(Menu<Wry>, Submenu<Wry>)> {
    // 기본 메뉴의 Quit은 terminate:를 직접 호출해 CloseRequested를 건너뛴다. 창 닫기로 우회시킨다.
    let quit = MenuItemBuilder::with_id("quit", "Quit Mini Mark")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Mini Mark")
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
    // 단축키는 메뉴 accelerator가 맡는다. 웹뷰 keydown과 겹치면 저장이 두 번 실행된다.
    let new = MenuItemBuilder::with_id("new", "New")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let open = MenuItemBuilder::with_id("open", "Open...")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let open_recent = SubmenuBuilder::with_id(app, "open-recent", "Open Recent").build()?;
    let save = MenuItemBuilder::with_id("save", "Save")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let save_as = MenuItemBuilder::with_id("saveAs", "Save As...")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new)
        .item(&open)
        .item(&open_recent)
        .separator()
        .item(&save)
        .item(&save_as)
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
        .items(&[&app_menu, &file_menu, &edit_menu, &window_menu])
        .build()?;
    Ok((menu, open_recent))
}

// ponytail: Dock 우클릭 종료와 로그아웃은 tao에 훅이 없어 가드를 타지 않는다. 필요하면 applicationShouldTerminate 처리 추가.
pub fn on_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    match id {
        "quit" => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.close();
            }
        }
        "new" | "open" | "save" | "saveAs" => {
            let _ = app.emit("document-action", id);
        }
        "clear-recent" => {
            let _ = recent::clear(app, &app.state::<RecentFiles>());
        }
        _ => {
            if let Some(index) = id
                .strip_prefix("recent:")
                .and_then(|i| i.parse::<usize>().ok())
                && let Some(path) = recent::path_at(&app.state::<RecentFiles>(), index)
            {
                let _ = app.emit("open-file", path);
            }
        }
    }
}

mod fs;

use std::sync::Mutex;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

/// Finder가 넘긴 파일 경로. 웹뷰 리스너가 생기기 전(`ready == false`)에 온 요청은 보관했다가
/// `take_opened_file`로 넘기고, 그 뒤 요청은 이벤트로만 보낸다.
#[derive(Default)]
struct OpenedFile {
    pending: Option<String>,
    ready: bool,
}

impl OpenedFile {
    fn opened(&mut self, path: String) -> Option<String> {
        if self.ready {
            return Some(path);
        }
        self.pending = Some(path);
        None
    }

    fn take(&mut self) -> Option<String> {
        self.ready = true;
        self.pending.take()
    }
}

fn first_file_path(urls: &[tauri::Url]) -> Option<String> {
    urls.iter()
        .filter(|u| u.scheme() == "file")
        .find_map(|u| u.to_file_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn take_opened_file(state: tauri::State<Mutex<OpenedFile>>) -> Option<String> {
    state.lock().unwrap().take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(OpenedFile::default()))
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
            fs::save_asset,
            take_opened_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // ponytail: 여러 파일을 동시에 열면 첫 파일만 연다. 다중 창이 필요해지면 창을 추가 생성.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event
                && let Some(path) = first_file_path(&urls)
                && let Some(path) = app
                    .state::<Mutex<OpenedFile>>()
                    .lock()
                    .unwrap()
                    .opened(path)
            {
                use tauri::Emitter;
                let _ = app.emit("open-file", path);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{OpenedFile, first_file_path};
    use tauri::Url;

    #[test]
    fn first_file_path_picks_first_file_url() {
        let urls = [
            Url::parse("https://example.com/a.md").unwrap(),
            Url::parse("file:///Users/me/notes/a%20b.md").unwrap(),
            Url::parse("file:///Users/me/notes/c.md").unwrap(),
        ];
        assert_eq!(
            first_file_path(&urls).as_deref(),
            Some("/Users/me/notes/a b.md")
        );
    }

    #[test]
    fn first_file_path_is_none_without_file_url() {
        let urls = [Url::parse("https://example.com/a.md").unwrap()];
        assert_eq!(first_file_path(&urls), None);
        assert_eq!(first_file_path(&[]), None);
    }

    #[test]
    fn opened_before_ready_is_stored() {
        let mut state = OpenedFile::default();
        assert_eq!(state.opened("/a.md".into()), None);
        assert_eq!(state.opened("/b.md".into()), None); // 마지막 요청이 남는다
        assert_eq!(state.take(), Some("/b.md".to_string()));
        assert_eq!(state.take(), None);
    }

    #[test]
    fn opened_after_ready_is_not_stored() {
        let mut state = OpenedFile::default();
        assert_eq!(state.take(), None);
        assert_eq!(state.opened("/a.md".into()), Some("/a.md".to_string()));
        assert_eq!(state.take(), None);
    }
}

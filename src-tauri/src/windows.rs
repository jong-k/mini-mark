use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{
    AppHandle, Emitter, Manager, RunEvent, State, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;

/// tauri.conf.json 첫 창의 라벨(Tauri 기본값)
pub const MAIN: &str = "main";

/// JS가 보고한 창의 문서 상태. `take`로 준비된 창만 항목이 있다.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Doc {
    pub path: Option<String>,
    pub dirty: bool,
}

impl Doc {
    /// 새 문서이고 수정이 없는 창. 열기 요청을 이 창에서 받는다.
    fn is_blank(&self) -> bool {
        self.path.is_none() && !self.dirty
    }
}

/// 라우팅 입력. 지금 떠 있는 창과 포커스 여부.
pub struct Existing<'a> {
    pub label: &'a str,
    pub focused: bool,
}

#[derive(Debug, PartialEq)]
pub enum Route {
    /// 이미 연 창을 앞으로
    Focus(String),
    /// 준비 전인 창에 보류했다. 창이 `take`하면 연다
    Pending(String),
    /// 빈 창에 open-file 이벤트를 보낸다
    Emit(String),
    /// 이 라벨로 새 창을 만든다. 경로는 보류해 두었다
    Create(String),
}

/// 창 라벨별 문서 상태와 보류 경로. 스펙은 docs/spec/windows.md.
#[derive(Default)]
pub struct Windows {
    next_id: u32,
    docs: HashMap<String, Doc>,
    pending: HashMap<String, String>,
    /// 어떤 창이든 한 번 준비됐다. 그 전에는 설정의 main 창이 아직 없을 수 있다.
    booted: bool,
    pub quitting: bool,
}

impl Windows {
    pub fn route_open(&mut self, path: &str, existing: &[Existing]) -> Route {
        if let Some(label) = self
            .docs
            .iter()
            .find(|(_, d)| d.path.as_deref() == Some(path))
            .map(|(l, _)| l.clone())
        {
            return Route::Focus(label);
        }
        // 준비 전인 창(콜드 스타트의 main, 막 만든 창)은 보류 경로로 넘긴다.
        // macOS는 설정의 main 창이 만들어지기 전에 Opened를 보낼 수 있어, 부팅 전에는 main이 목록에 없어도 보류한다.
        let unready =
            |label: &str| !self.docs.contains_key(label) && !self.pending.contains_key(label);
        if let Some(label) = existing
            .iter()
            .map(|w| w.label)
            .find(|l| unready(l))
            .or_else(|| (!self.booted && unready(MAIN)).then_some(MAIN))
        {
            self.pending.insert(label.to_string(), path.to_string());
            return Route::Pending(label.to_string());
        }
        let blank = |w: &&Existing| self.docs.get(w.label).is_some_and(Doc::is_blank);
        if let Some(w) = existing
            .iter()
            .find(|w| w.focused && blank(w))
            .or_else(|| existing.iter().find(blank))
        {
            // JS 보고보다 먼저 오는 다음 경로가 같은 창을 다시 쓰지 않도록 미리 적어 둔다.
            self.set_doc(
                w.label,
                Doc {
                    path: Some(path.to_string()),
                    dirty: false,
                },
            );
            return Route::Emit(w.label.to_string());
        }
        let label = self.new_label();
        self.pending.insert(label.clone(), path.to_string());
        Route::Create(label)
    }

    /// 창을 준비 상태로 표시하고 보류 경로를 한 번 돌려준다.
    pub fn take(&mut self, label: &str) -> Option<String> {
        self.booted = true;
        self.docs.entry(label.to_string()).or_default();
        self.pending.remove(label)
    }

    pub fn set_doc(&mut self, label: &str, doc: Doc) {
        self.docs.insert(label.to_string(), doc);
    }

    /// "win-1", "win-2", ... 번호는 늘기만 한다.
    pub fn new_label(&mut self) -> String {
        self.next_id += 1;
        format!("win-{}", self.next_id)
    }

    /// 창이 사라지면 상태와 보류 경로를 지운다.
    pub fn forget(&mut self, label: &str) {
        self.docs.remove(label);
        self.pending.remove(label);
    }
}

type Shared<'a> = State<'a, Mutex<Windows>>;

fn existing(app: &AppHandle) -> Vec<(String, bool)> {
    app.webview_windows()
        .into_iter()
        .map(|(label, w)| (label, w.is_focused().unwrap_or(false)))
        .collect()
}

/// 앞 창(포커스된 창)의 라벨. 메뉴가 Save, Find를 이 창에만 보낸다.
pub fn focused_label(app: &AppHandle) -> Option<String> {
    existing(app).into_iter().find(|(_, f)| *f).map(|(l, _)| l)
}

/// `tauri.conf.json`의 첫 창 설정을 복제해 라벨만 바꾼다. 앞 창이 있으면 오른쪽 아래로 24pt 비켜 띄운다.
fn create_window(app: &AppHandle, label: &str) -> tauri::Result<WebviewWindow> {
    let mut cfg = app.config().app.windows[0].clone();
    cfg.label = label.to_string();
    let mut builder = WebviewWindowBuilder::from_config(app, &cfg)?;
    if let Some(front) = focused_label(app).and_then(|l| app.get_webview_window(&l))
        && let (Ok(pos), Ok(scale)) = (front.outer_position(), front.scale_factor())
    {
        let pos = pos.to_logical::<f64>(scale);
        builder = builder.position(pos.x + 24.0, pos.y + 24.0);
    }
    builder.build()
}

/// 모든 열기 요청(Cmd+O, Open Recent, Finder, 콜드 스타트)이 여기로 모인다.
pub fn open_file(app: &AppHandle, path: String) {
    let route = {
        let windows = existing(app);
        let existing: Vec<Existing> = windows
            .iter()
            .map(|(l, f)| Existing {
                label: l,
                focused: *f,
            })
            .collect();
        app.state::<Mutex<Windows>>()
            .lock()
            .unwrap()
            .route_open(&path, &existing)
    };
    // 실패를 보여 줄 창이 없을 수 있어 로그만 남긴다.
    let result = match route {
        Route::Focus(label) => app
            .get_webview_window(&label)
            .map_or(Ok(()), |w| w.set_focus()),
        Route::Pending(_) => Ok(()),
        Route::Emit(label) => app.emit_to(label, "open-file", path),
        Route::Create(label) => create_window(app, &label).map(|_| ()),
    };
    if let Err(e) = result {
        eprintln!("open_file: {e}");
    }
}

/// Cmd+N과 Dock 재열기. 빈 문서로 새 창을 연다.
pub fn open_blank(app: &AppHandle) {
    let label = app.state::<Mutex<Windows>>().lock().unwrap().new_label();
    if let Err(e) = create_window(app, &label) {
        eprintln!("open_blank: {e}");
    }
}

/// Cmd+O. 창이 없어도 동작하도록 Rust가 대화상자를 띄운다.
pub fn pick_and_open(app: &AppHandle) {
    let handle = app.clone();
    app.dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .pick_file(move |picked| {
            if let Some(path) = picked.and_then(|f| f.into_path().ok()) {
                open_file(&handle, path.to_string_lossy().into_owned());
            }
        });
}

/// Cmd+Q. 창마다 닫기 가드(JS)를 거친다. 하나라도 취소하면 JS가 `cancel_quit`를 불러 멈춘다.
pub fn quit(app: &AppHandle) {
    app.state::<Mutex<Windows>>().lock().unwrap().quitting = true;
    let windows = app.webview_windows();
    if windows.is_empty() {
        app.exit(0);
        return;
    }
    for w in windows.into_values() {
        let _ = w.close();
    }
}

pub fn on_run_event(app: &AppHandle, event: RunEvent) {
    match event {
        #[cfg(target_os = "macos")]
        RunEvent::Opened { urls } => {
            for path in urls
                .iter()
                .filter(|u| u.scheme() == "file")
                .filter_map(|u| u.to_file_path().ok())
            {
                open_file(app, path.to_string_lossy().into_owned());
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => open_blank(app),
        // 마지막 창이 닫혀도 앱은 남는다. 종료는 Cmd+Q의 `app.exit`(code Some)로만 한다.
        RunEvent::ExitRequested {
            code: None, api, ..
        } => api.prevent_exit(),
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::Destroyed,
            ..
        } => {
            let state = app.state::<Mutex<Windows>>();
            let mut windows = state.lock().unwrap();
            windows.forget(&label);
            // 파괴 중인 창이 아직 목록에 남아 있을 수 있어 그 라벨은 빼고 센다.
            if windows.quitting && app.webview_windows().keys().all(|l| *l == label) {
                app.exit(0);
            }
        }
        _ => {}
    }
}

/// 이 창에 보류된 경로. 콜드 스타트의 Finder 인자나 새 창에 열 파일이다. 창을 준비 상태로 표시한다.
#[tauri::command]
pub fn take_opened_file(window: WebviewWindow, state: Shared) -> Option<String> {
    state.lock().unwrap().take(window.label())
}

#[tauri::command]
pub fn set_document_state(window: WebviewWindow, state: Shared, path: Option<String>, dirty: bool) {
    state
        .lock()
        .unwrap()
        .set_doc(window.label(), Doc { path, dirty });
}

#[tauri::command]
pub fn cancel_quit(state: Shared) {
    state.lock().unwrap().quitting = false;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win(label: &str, focused: bool) -> Existing<'_> {
        Existing { label, focused }
    }

    fn open(path: &str, dirty: bool) -> Doc {
        Doc {
            path: Some(path.to_string()),
            dirty,
        }
    }

    #[test]
    fn cold_start_stores_path_for_unready_main() {
        let mut w = Windows::default();
        assert_eq!(
            w.route_open("/a.md", &[win(MAIN, false)]),
            Route::Pending(MAIN.to_string())
        );
        assert_eq!(w.take(MAIN), Some("/a.md".to_string()));
        assert_eq!(w.take(MAIN), None);
    }

    #[test]
    fn cold_start_with_two_files_uses_main_then_new_window() {
        let mut w = Windows::default();
        assert_eq!(
            w.route_open("/a.md", &[win(MAIN, false)]),
            Route::Pending(MAIN.to_string())
        );
        assert_eq!(
            w.route_open("/b.md", &[win(MAIN, false)]),
            Route::Create("win-1".to_string())
        );
        assert_eq!(w.take("win-1"), Some("/b.md".to_string()));
    }

    #[test]
    fn already_open_path_focuses_that_window() {
        let mut w = Windows::default();
        w.take(MAIN);
        w.set_doc(MAIN, open("/a.md", true));
        assert_eq!(
            w.route_open("/a.md", &[win(MAIN, true)]),
            Route::Focus(MAIN.to_string())
        );
    }

    #[test]
    fn focused_blank_window_is_reused() {
        let mut w = Windows::default();
        w.take(MAIN);
        assert_eq!(
            w.route_open("/a.md", &[win(MAIN, true)]),
            Route::Emit(MAIN.to_string())
        );
    }

    #[test]
    fn unfocused_blank_window_is_reused_when_front_is_not_blank() {
        let mut w = Windows::default();
        w.take(MAIN);
        w.set_doc(
            MAIN,
            Doc {
                path: None,
                dirty: true,
            },
        );
        w.take("win-1");
        assert_eq!(
            w.route_open("/a.md", &[win(MAIN, true), win("win-1", false)]),
            Route::Emit("win-1".to_string())
        );
    }

    #[test]
    fn no_blank_window_creates_new_one_with_pending_path() {
        let mut w = Windows::default();
        w.take(MAIN);
        w.set_doc(MAIN, open("/a.md", true));
        assert_eq!(
            w.route_open("/b.md", &[win(MAIN, true)]),
            Route::Create("win-1".to_string())
        );
        assert_eq!(
            w.route_open("/c.md", &[win(MAIN, true), win("win-1", false)]),
            Route::Create("win-2".to_string())
        );
        assert_eq!(w.take("win-2"), Some("/c.md".to_string()));
    }

    #[test]
    fn pending_window_is_not_reused_for_a_second_path() {
        let mut w = Windows::default();
        w.take(MAIN);
        w.set_doc(MAIN, open("/a.md", false));
        assert_eq!(
            w.route_open("/b.md", &[win(MAIN, true)]),
            Route::Create("win-1".to_string())
        );
        // win-1은 떠 있지만 아직 take 전이다. 보류 경로가 있으니 다시 쓰지 않는다.
        assert_eq!(
            w.route_open("/d.md", &[win(MAIN, true), win("win-1", false)]),
            Route::Create("win-2".to_string())
        );
        assert_eq!(w.take("win-1"), Some("/b.md".to_string()));
    }

    #[test]
    fn forget_removes_doc_and_pending() {
        let mut w = Windows::default();
        w.take(MAIN);
        w.set_doc(MAIN, open("/a.md", false));
        assert_eq!(
            w.route_open("/b.md", &[win(MAIN, true)]),
            Route::Create("win-1".to_string())
        );
        w.forget("win-1");
        assert_eq!(w.take("win-1"), None);
        w.forget(MAIN);
        assert_ne!(
            w.route_open("/a.md", &[win("win-1", true)]),
            Route::Focus(MAIN.to_string())
        );
    }

    #[test]
    fn cold_start_before_any_window_exists_stores_path_for_main() {
        // macOS는 설정의 창이 만들어지기 전에 Opened를 보낼 수 있다.
        let mut w = Windows::default();
        assert_eq!(w.route_open("/a.md", &[]), Route::Pending(MAIN.to_string()));
        assert_eq!(
            w.route_open("/b.md", &[]),
            Route::Create("win-1".to_string())
        );
        assert_eq!(w.take(MAIN), Some("/a.md".to_string()));
        assert_eq!(w.take("win-1"), Some("/b.md".to_string()));
    }

    #[test]
    fn emit_marks_window_as_taken_so_a_second_path_creates_a_window() {
        // Finder에서 여러 파일을 열면 JS 보고보다 먼저 다음 경로가 온다.
        let mut w = Windows::default();
        w.take(MAIN);
        assert_eq!(
            w.route_open("/b.md", &[win(MAIN, true)]),
            Route::Emit(MAIN.to_string())
        );
        assert_eq!(
            w.route_open("/c.md", &[win(MAIN, true)]),
            Route::Create("win-1".to_string())
        );
        assert_eq!(
            w.route_open("/b.md", &[win(MAIN, true), win("win-1", false)]),
            Route::Focus(MAIN.to_string())
        );
    }

    #[test]
    fn new_label_never_repeats() {
        let mut w = Windows::default();
        assert_eq!(w.new_label(), "win-1");
        w.forget("win-1");
        assert_eq!(w.new_label(), "win-2");
    }
}

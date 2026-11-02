use std::collections::HashMap;

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
        if let Some(w) = existing
            .iter()
            .find(|w| !self.docs.contains_key(w.label) && !self.pending.contains_key(w.label))
        {
            self.pending.insert(w.label.to_string(), path.to_string());
            return Route::Pending(w.label.to_string());
        }
        let blank = |w: &&Existing| self.docs.get(w.label).is_some_and(Doc::is_blank);
        if let Some(w) = existing
            .iter()
            .find(|w| w.focused && blank(w))
            .or_else(|| existing.iter().find(blank))
        {
            return Route::Emit(w.label.to_string());
        }
        let label = self.new_label();
        self.pending.insert(label.clone(), path.to_string());
        Route::Create(label)
    }

    /// 창을 준비 상태로 표시하고 보류 경로를 한 번 돌려준다.
    pub fn take(&mut self, label: &str) -> Option<String> {
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
    fn new_label_never_repeats() {
        let mut w = Windows::default();
        assert_eq!(w.new_label(), "win-1");
        w.forget("win-1");
        assert_eq!(w.new_label(), "win-2");
    }
}

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::menu::{MenuItemBuilder, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, State, Wry};

pub const MAX_RECENT: usize = 10;

pub struct RecentFiles {
    pub list: Mutex<Vec<String>>,
    pub menu: Submenu<Wry>,
    pub store_path: PathBuf,
}

pub fn push_recent(list: &mut Vec<String>, path: &str) {
    list.retain(|p| p != path);
    list.insert(0, path.to_string());
    list.truncate(MAX_RECENT);
}

/// 없거나 깨진 파일은 빈 목록으로 시작한다.
pub fn load(path: &Path) -> Vec<String> {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn store(path: &Path, list: &[String]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string(list).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

// ponytail: 파일명만 표시해 같은 이름의 파일은 구분되지 않는다. 필요하면 상위 폴더명을 붙인다.
// 사라진 파일도 지우지 않는다. 열기 실패는 기존 오류 대화상자로 보인다.
pub fn rebuild_menu(menu: &Submenu<Wry>, app: &AppHandle, list: &[String]) -> tauri::Result<()> {
    while menu.remove_at(0)?.is_some() {}
    for (i, path) in list.iter().enumerate() {
        let name = Path::new(path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone());
        menu.append(&MenuItemBuilder::with_id(format!("recent:{i}"), name).build(app)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(
        &MenuItemBuilder::with_id("clear-recent", "Clear Menu")
            .enabled(!list.is_empty())
            .build(app)?,
    )?;
    Ok(())
}

pub fn clear(app: &AppHandle, state: &RecentFiles) -> Result<(), String> {
    let mut list = state.list.lock().unwrap();
    list.clear();
    store(&state.store_path, &list)?;
    rebuild_menu(&state.menu, app, &list).map_err(|e| e.to_string())
}

pub fn path_at(state: &RecentFiles, index: usize) -> Option<String> {
    state.list.lock().unwrap().get(index).cloned()
}

#[tauri::command]
pub fn add_recent_file(
    app: AppHandle,
    state: State<RecentFiles>,
    path: String,
) -> Result<(), String> {
    let mut list = state.list.lock().unwrap();
    push_recent(&mut list, &path);
    store(&state.store_path, &list)?;
    rebuild_menu(&state.menu, &app, &list).map_err(|e| e.to_string())
}

pub fn setup(app: &AppHandle, menu: Submenu<Wry>) -> tauri::Result<()> {
    let store_path = app.path().app_data_dir()?.join("recent-files.json");
    let list = load(&store_path);
    rebuild_menu(&menu, app, &list)?;
    app.manage(RecentFiles {
        list: Mutex::new(list),
        menu,
        store_path,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_recent_moves_duplicate_to_front() {
        let mut list = vec!["/a.md".to_string(), "/b.md".to_string()];
        push_recent(&mut list, "/b.md");
        assert_eq!(list, vec!["/b.md", "/a.md"]);
    }

    #[test]
    fn push_recent_keeps_at_most_ten() {
        let mut list: Vec<String> = (0..10).map(|i| format!("/{i}.md")).collect();
        push_recent(&mut list, "/new.md");
        assert_eq!(list.len(), MAX_RECENT);
        assert_eq!(list[0], "/new.md");
        assert!(!list.contains(&"/9.md".to_string()));
    }

    #[test]
    fn store_then_load_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("nested").join("recent-files.json");
        store(&p, &["/a.md".to_string()]).unwrap();
        assert_eq!(load(&p), vec!["/a.md"]);
    }

    #[test]
    fn load_returns_empty_when_missing_or_invalid() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load(&dir.path().join("none.json")).is_empty());
        let bad = dir.path().join("bad.json");
        std::fs::write(&bad, "{not json").unwrap();
        assert!(load(&bad).is_empty());
    }
}

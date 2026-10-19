use std::fs::{self, File};
use std::path::Path;

#[tauri::command]
pub fn read_markdown(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_markdown_atomic(path: String, content: String) -> Result<(), String> {
    let path = Path::new(&path);
    let file_name = path
        .file_name()
        .ok_or_else(|| "invalid file path".to_string())?
        .to_string_lossy();
    let tmp = path.with_file_name(format!("{file_name}.tmp"));
    let result = fs::write(&tmp, content)
        .and_then(|_| File::open(&tmp)?.sync_all())
        // ponytail: rename은 원본 inode를 교체하므로 원본의 권한/xattr은 유지되지 않는다. 필요해지면 metadata 복사 추가.
        .and_then(|_| fs::rename(&tmp, path));
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn save_then_read_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        save_markdown_atomic(path.to_string_lossy().into(), "# hi\n".into()).unwrap();
        assert_eq!(
            read_markdown(path.to_string_lossy().into()).unwrap(),
            "# hi\n"
        );
    }

    #[test]
    fn save_overwrites_existing_and_leaves_no_tmp() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        fs::write(&path, "old").unwrap();
        save_markdown_atomic(path.to_string_lossy().into(), "new".into()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn read_missing_file_is_err() {
        assert!(read_markdown("/nonexistent/x.md".into()).is_err());
    }
}

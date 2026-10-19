use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[tauri::command]
pub fn read_markdown(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_markdown_atomic(path: String, content: String) -> Result<(), String> {
    // symlink면 링크 대상에 쓴다. 새 파일은 canonicalize가 실패하므로 받은 경로를 그대로 쓴다.
    let path = fs::canonicalize(&path).unwrap_or_else(|_| PathBuf::from(&path));
    let file_name = path
        .file_name()
        .ok_or_else(|| "invalid file path".to_string())?
        .to_string_lossy();
    // create_new(O_EXCL)는 해당 경로에 무엇이든(symlink 포함) 있으면 실패하므로 기존 파일을 건드리지 않는다.
    let mut attempt = 0;
    let (tmp, mut file) = loop {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let tmp = path.with_file_name(format!(".{file_name}.{}.{nanos}.tmp", std::process::id()));
        match OpenOptions::new().write(true).create_new(true).open(&tmp) {
            Ok(f) => break (tmp, f),
            Err(e) if e.kind() == ErrorKind::AlreadyExists && attempt < 9 => attempt += 1,
            Err(e) => return Err(e.to_string()),
        }
    };
    let result = file
        .write_all(content.as_bytes())
        .and_then(|_| file.sync_all());
    drop(file);
    // ponytail: rename은 원본 inode를 교체하므로 원본의 권한/xattr은 유지되지 않는다. 필요해지면 metadata 복사 추가.
    let result = result.and_then(|_| fs::rename(&tmp, &path));
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
    fn save_fails_when_target_is_directory_and_leaves_no_tmp() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        fs::create_dir(&path).unwrap();
        assert!(save_markdown_atomic(path.to_string_lossy().into(), "new".into()).is_err());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn save_preserves_existing_tmp_named_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        let tmp = dir.path().join("a.md.tmp");
        fs::write(&tmp, "keep").unwrap();
        save_markdown_atomic(path.to_string_lossy().into(), "new".into()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        assert_eq!(fs::read_to_string(&tmp).unwrap(), "keep");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
    }

    #[test]
    fn save_preserves_tmp_symlink_and_target() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        let tmp = dir.path().join("a.md.tmp");
        fs::write(&path, "old").unwrap();
        std::os::unix::fs::symlink(&path, &tmp).unwrap();
        save_markdown_atomic(path.to_string_lossy().into(), "new".into()).unwrap();
        assert!(fs::symlink_metadata(&path).unwrap().file_type().is_file());
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        assert!(fs::symlink_metadata(&tmp).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
    }

    #[test]
    fn read_missing_file_is_err() {
        assert!(read_markdown("/nonexistent/x.md".into()).is_err());
    }
}

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
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

// ponytail: data는 JSON 배열로 넘어온다. 수 MB 이미지가 느리면 tauri::ipc::Request raw body로 교체.
#[tauri::command]
pub fn save_asset(dir: String, file_name: String, data: Vec<u8>) -> Result<String, String> {
    if file_name.is_empty() || file_name.starts_with('.') || file_name.contains(['/', '\\']) {
        return Err(format!("invalid asset file name: {file_name}"));
    }
    let assets = Path::new(&dir).join("assets");
    fs::create_dir_all(&assets).map_err(|e| e.to_string())?;
    let (stem, ext) = match file_name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (file_name.clone(), String::new()),
    };
    for n in 0..100u32 {
        let name = if n == 0 {
            file_name.clone()
        } else {
            format!("{stem}-{n}{ext}")
        };
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(assets.join(&name))
        {
            Ok(mut file) => {
                file.write_all(&data).map_err(|e| e.to_string())?;
                return Ok(format!("assets/{name}"));
            }
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err(format!("too many assets named {file_name}"))
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

    #[test]
    fn save_asset_writes_under_assets_and_returns_relative_path() {
        let dir = tempfile::tempdir().unwrap();
        let rel = save_asset(
            dir.path().to_string_lossy().into(),
            "a.png".into(),
            vec![1, 2, 3],
        )
        .unwrap();
        assert_eq!(rel, "assets/a.png");
        assert_eq!(
            fs::read(dir.path().join("assets/a.png")).unwrap(),
            vec![1, 2, 3]
        );
    }

    #[test]
    fn save_asset_adds_suffix_on_collision() {
        let dir = tempfile::tempdir().unwrap();
        let d: String = dir.path().to_string_lossy().into();
        save_asset(d.clone(), "a.png".into(), vec![1]).unwrap();
        let second = save_asset(d.clone(), "a.png".into(), vec![2]).unwrap();
        let third = save_asset(d, "a.png".into(), vec![3]).unwrap();
        assert_eq!(second, "assets/a-1.png");
        assert_eq!(third, "assets/a-2.png");
        assert_eq!(fs::read(dir.path().join("assets/a.png")).unwrap(), vec![1]);
    }

    #[test]
    fn save_asset_rejects_path_traversal_and_hidden_names() {
        let dir = tempfile::tempdir().unwrap();
        let d: String = dir.path().to_string_lossy().into();
        assert!(save_asset(d.clone(), "../x.png".into(), vec![1]).is_err());
        assert!(save_asset(d.clone(), ".hidden".into(), vec![1]).is_err());
        assert!(save_asset(d, "".into(), vec![1]).is_err());
    }
}

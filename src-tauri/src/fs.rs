use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request};

fn millis(time: SystemTime) -> Result<u64, String> {
    Ok(time
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64)
}

// 동기 커맨드는 메인 스레드에서 실행된다. 디스크 I/O가 UI를 멈추지 않게 fs 커맨드는 별도 스레드로 보낸다.
#[tauri::command(async)]
pub fn read_markdown(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command(async)]
/// 저장된 파일의 mtime(ms)을 돌려준다.
pub fn save_markdown_atomic(path: String, content: String) -> Result<u64, String> {
    // symlink면 링크 대상에 쓴다. 새 파일은 canonicalize가 실패하므로 받은 경로를 그대로 쓴다.
    let path = fs::canonicalize(&path).unwrap_or_else(|_| PathBuf::from(&path));
    let file_name = path
        .file_name()
        .ok_or_else(|| "invalid file path".to_string())?
        .to_string_lossy();
    // 원본이 있으면 임시 파일을 0600으로 만들고 교체 전에 원본 권한을 복사한다. 기본 권한으로 만들면 0600 파일이 0644로 넓어진다.
    let original_permissions = fs::metadata(&path).ok().map(|m| m.permissions());
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    if original_permissions.is_some() {
        options.mode(0o600);
    }
    // create_new(O_EXCL)는 해당 경로에 무엇이든(symlink 포함) 있으면 실패하므로 기존 파일을 건드리지 않는다.
    let mut attempt = 0;
    let (tmp, mut file) = loop {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let tmp = path.with_file_name(format!(".{file_name}.{}.{nanos}.tmp", std::process::id()));
        match options.open(&tmp) {
            Ok(f) => break (tmp, f),
            Err(e) if e.kind() == ErrorKind::AlreadyExists && attempt < 9 => attempt += 1,
            Err(e) => return Err(e.to_string()),
        }
    };
    let written = file
        .write_all(content.as_bytes())
        .and_then(|_| file.sync_all())
        .and_then(|_| file.metadata())
        .and_then(|m| m.modified());
    drop(file);
    let result = written.and_then(|modified| {
        if let Some(permissions) = original_permissions {
            fs::set_permissions(&tmp, permissions)?;
        }
        // ponytail: rename은 원본 inode를 교체하므로 xattr(Finder 태그)은 유지되지 않는다. 필요해지면 copyfile로 복사.
        // rename은 mtime을 바꾸지 않으므로 교체 전에 읽은 임시 파일의 mtime이 저장된 파일의 mtime이다.
        // 교체 뒤에 stat하면 그 사이 들어온 외부 수정의 mtime을 기준으로 삼아 변경을 놓친다.
        fs::rename(&tmp, &path)?;
        Ok(modified)
    });
    match result {
        Ok(modified) => millis(modified),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e.to_string())
        }
    }
}

/// 바이트는 raw body로, 경로와 파일명은 percent 인코딩한 헤더로 받는다. JSON 배열보다 복사가 적다.
#[tauri::command(async)]
pub fn save_asset(request: Request<'_>) -> Result<String, String> {
    let header = |name: &str| -> Result<String, String> {
        let raw = request
            .headers()
            .get(name)
            .ok_or_else(|| format!("missing header: {name}"))?
            .to_str()
            .map_err(|e| e.to_string())?;
        Ok(percent_decode_str(raw)
            .decode_utf8()
            .map_err(|e| e.to_string())?
            .into_owned())
    };
    let dir = header("dir")?;
    let file_name = header("file-name")?;
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw body".to_string());
    };
    write_asset(&dir, &file_name, data)
}

pub fn write_asset(dir: &str, file_name: &str, data: &[u8]) -> Result<String, String> {
    if file_name.is_empty() || file_name.starts_with('.') || file_name.contains(['/', '\\']) {
        return Err(format!("invalid asset file name: {file_name}"));
    }
    let assets = Path::new(dir).join("assets");
    fs::create_dir_all(&assets).map_err(|e| e.to_string())?;
    let (stem, ext) = match file_name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (file_name.to_string(), String::new()),
    };
    for n in 0..100u32 {
        let name = if n == 0 {
            file_name.to_string()
        } else {
            format!("{stem}-{n}{ext}")
        };
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(assets.join(&name))
        {
            Ok(mut file) => {
                file.write_all(data).map_err(|e| e.to_string())?;
                return Ok(format!("assets/{name}"));
            }
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err(format!("too many assets named {file_name}"))
}

#[tauri::command(async)]
pub fn file_modified_at(path: String) -> Result<u64, String> {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .map_err(|e| e.to_string())
        .and_then(millis)
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
    fn save_keeps_original_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        fs::write(&path, "old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        save_markdown_atomic(path.to_string_lossy().into(), "new".into()).unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn save_new_file_is_not_forced_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        save_markdown_atomic(path.to_string_lossy().into(), "new".into()).unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        let plain = dir.path().join("plain.md");
        fs::write(&plain, "x").unwrap();
        // 새 파일은 umask 기본 권한을 따른다. 임시 파일에 적용한 0600이 남지 않아야 한다.
        assert_eq!(
            mode,
            fs::metadata(&plain).unwrap().permissions().mode() & 0o777
        );
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
    fn save_returns_mtime_of_saved_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        let saved = save_markdown_atomic(path.to_string_lossy().into(), "x".into()).unwrap();
        assert_eq!(
            saved,
            file_modified_at(path.to_string_lossy().into()).unwrap()
        );
    }

    #[test]
    fn write_asset_writes_under_assets_and_returns_relative_path() {
        let dir = tempfile::tempdir().unwrap();
        let rel = write_asset(&dir.path().to_string_lossy(), "a.png", &[1, 2, 3]).unwrap();
        assert_eq!(rel, "assets/a.png");
        assert_eq!(
            fs::read(dir.path().join("assets/a.png")).unwrap(),
            vec![1, 2, 3]
        );
    }

    #[test]
    fn write_asset_adds_suffix_on_collision() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path().to_string_lossy();
        write_asset(&d, "a.png", &[1]).unwrap();
        let second = write_asset(&d, "a.png", &[2]).unwrap();
        let third = write_asset(&d, "a.png", &[3]).unwrap();
        assert_eq!(second, "assets/a-1.png");
        assert_eq!(third, "assets/a-2.png");
        assert_eq!(fs::read(dir.path().join("assets/a.png")).unwrap(), vec![1]);
    }

    #[test]
    fn write_asset_rejects_path_traversal_and_hidden_names() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path().to_string_lossy();
        assert!(write_asset(&d, "../x.png", &[1]).is_err());
        assert!(write_asset(&d, ".hidden", &[1]).is_err());
        assert!(write_asset(&d, "", &[1]).is_err());
    }

    #[test]
    fn file_modified_at_returns_mtime_millis() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.md");
        fs::write(&p, "x").unwrap();
        let f = fs::OpenOptions::new().write(true).open(&p).unwrap();
        f.set_modified(UNIX_EPOCH + std::time::Duration::from_secs(1_000_000))
            .unwrap();
        assert_eq!(
            file_modified_at(p.to_string_lossy().into()).unwrap(),
            1_000_000_000
        );
    }

    #[test]
    fn file_modified_at_is_err_for_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        assert!(file_modified_at(dir.path().join("none.md").to_string_lossy().into()).is_err());
    }
}

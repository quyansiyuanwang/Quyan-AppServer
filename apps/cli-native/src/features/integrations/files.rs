use anyhow::{ensure, Context, Result};
use serde_json::{Map, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub fn read(path: &Path) -> Result<Option<String>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => ensure!(
            metadata.file_type().is_file(),
            "Refusing a non-regular client config file"
        ),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error).context("Cannot inspect client config"),
    }
    Ok(Some(
        fs::read_to_string(path).context("Cannot read client config; no changes made")?,
    ))
}
pub fn json_object(current: Option<&str>) -> Result<Map<String, Value>> {
    match current {
        Some(text) => serde_json::from_str::<Value>(text)
            .ok()
            .and_then(|v| v.as_object().cloned())
            .context("Client config must be a valid JSON object; no changes made"),
        None => Ok(Map::new()),
    }
}
pub fn object_entry<'a>(
    value: &'a mut Map<String, Value>,
    key: &str,
) -> Result<&'a mut Map<String, Value>> {
    value
        .entry(key)
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .context("Existing configuration section is not an object; no changes made")
}
pub fn serialize_json(value: &Map<String, Value>) -> Result<String> {
    Ok(format!("{}\n", serde_json::to_string_pretty(value)?))
}

pub struct WriteResult {
    pub changed: bool,
    pub backup: Option<PathBuf>,
}

pub fn write(
    path: &Path,
    original: Option<&str>,
    next: &str,
    dry_run: bool,
    backup: bool,
) -> Result<WriteResult> {
    if original.is_some_and(|value| value == next) {
        return Ok(WriteResult {
            changed: false,
            backup: None,
        });
    }
    if dry_run {
        return Ok(WriteResult {
            changed: true,
            backup: None,
        });
    }
    let parent = path.parent().context("Missing client config directory")?;
    fs::create_dir_all(parent)?;
    ensure!(
        read(path)?.as_deref() == original,
        "Client config changed during preparation; retry instead of overwriting it"
    );
    let backup_path = if backup && original.is_some() {
        let mut saved = tempfile::Builder::new()
            .prefix(&format!(
                "{}.quyan-",
                path.file_name().unwrap().to_string_lossy()
            ))
            .suffix(".bak")
            .tempfile_in(parent)?;
        saved.write_all(original.unwrap().as_bytes())?;
        saved.as_file().sync_all()?;
        Some(saved.keep()?.1)
    } else {
        None
    };
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    temp.write_all(next.as_bytes())?;
    temp.as_file().sync_all()?;
    temp.persist(path)
        .context("Could not atomically replace client config")?;
    Ok(WriteResult {
        changed: true,
        backup: backup_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backups_are_unique_and_preserve_original_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("client.json");
        fs::write(&path, "first").unwrap();
        let first = write(&path, Some("first"), "second", false, true)
            .unwrap()
            .backup
            .unwrap();
        let second = write(&path, Some("second"), "third", false, true)
            .unwrap()
            .backup
            .unwrap();
        assert_ne!(first, second);
        assert_eq!(fs::read_to_string(first).unwrap(), "first");
        assert_eq!(fs::read_to_string(second).unwrap(), "second");
        assert_eq!(fs::read_to_string(path).unwrap(), "third");
    }
    #[test]
    fn stale_snapshot_is_rejected_and_dry_run_creates_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/client.json");
        write(&path, None, "preview", true, true).unwrap();
        assert!(!path.parent().unwrap().exists());
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "concurrent").unwrap();
        assert!(write(&path, Some("old"), "replacement", false, true).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "concurrent");
    }
    #[cfg(unix)]
    #[test]
    fn secrets_in_preexisting_backups_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("client.json");
        fs::write(&path, "old").unwrap();
        let backup = write(&path, Some("old"), "new", false, true)
            .unwrap()
            .backup
            .unwrap();
        assert_eq!(
            fs::metadata(backup).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}

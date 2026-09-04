use anyhow::{Context, Result};
use serde_json::{Map, Value};
use std::{fs, path::PathBuf};

use crate::credentials::Credentials;

fn merge(file: PathBuf, patch: Value, dry_run: bool, backup: bool) -> Result<bool> {
    let current: Value = fs::read(&file)
        .ok()
        .and_then(|v| serde_json::from_slice(&v).ok())
        .unwrap_or_else(|| Value::Object(Map::new()));
    let mut next = current.clone();
    if let (Value::Object(dst), Value::Object(src)) = (&mut next, patch) {
        for (key, value) in src {
            dst.insert(key, value);
        }
    }
    if next == current {
        return Ok(false);
    }
    if dry_run {
        return Ok(true);
    }
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    if backup && file.exists() {
        fs::copy(&file, file.with_extension("json.bak"))?;
    }
    let temp = file.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(&temp, format!("{}\n", serde_json::to_string_pretty(&next)?))?;
    fs::rename(temp, file).context("failed to atomically update integration config")?;
    Ok(true)
}

pub fn apply(
    credentials: &Credentials,
    client: Option<&str>,
    dry_run: bool,
    backup: bool,
) -> Result<Value> {
    let mut results = Map::new();
    let relay = credentials.relay_token.clone().unwrap_or_default();
    let home = dirs::home_dir().context("home directory is unavailable")?;
    if client.is_none() || client == Some("claude-code") {
        let file = home.join(".claude/settings.json");
        let changed = merge(
            file.clone(),
            serde_json::json!({"env":{"ANTHROPIC_AUTH_TOKEN":relay,"ANTHROPIC_BASE_URL":"https://ai.qysyw.cn"}}),
            dry_run,
            backup,
        )?;
        results.insert(
            "claude-code".into(),
            serde_json::json!({"changed":changed,"path":file}),
        );
    }
    if client.is_none() || client == Some("codex") {
        let file = home.join(".codex/config.json");
        let changed = merge(
            file.clone(),
            serde_json::json!({"apiKey":relay,"baseUrl":"https://ai.qysyw.cn"}),
            dry_run,
            backup,
        )?;
        results.insert(
            "codex".into(),
            serde_json::json!({"changed":changed,"path":file}),
        );
    }
    Ok(Value::Object(results))
}

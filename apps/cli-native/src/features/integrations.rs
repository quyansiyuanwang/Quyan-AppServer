use anyhow::{Context, Result};
use serde_json::{Map, Value};
use std::{fs, path::PathBuf};

use crate::core::credentials::Credentials;

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

    // Claude Code (Official Claude Desktop & VS Code extension)
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

    // Codex
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

    // Cursor
    if client.is_none() || client == Some("cursor") {
        let appdata = std::env::var("APPDATA")
            .ok()
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData/Roaming"));
        let file = appdata.join("Cursor/User/settings.json");
        let changed = merge(
            file.clone(),
            serde_json::json!({
                "cursor.general.apiKey": relay,
                "cursor.general.apiUrl": "https://ai.qysyw.cn"
            }),
            dry_run,
            backup,
        )?;
        results.insert(
            "cursor".into(),
            serde_json::json!({"changed":changed,"path":file}),
        );
    }

    // Continue.dev
    if client.is_none() || client == Some("continue") {
        let file = home.join(".continue/config.json");
        let changed = merge(
            file.clone(),
            serde_json::json!({
                "models": [{
                    "title": "Quyan Relay",
                    "provider": "anthropic",
                    "model": "claude-3-5-sonnet-20241022",
                    "apiKey": relay,
                    "apiBase": "https://ai.qysyw.cn"
                }]
            }),
            dry_run,
            backup,
        )?;
        results.insert(
            "continue".into(),
            serde_json::json!({"changed":changed,"path":file}),
        );
    }

    // Windsurf
    if client.is_none() || client == Some("windsurf") {
        let appdata = std::env::var("APPDATA")
            .ok()
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData/Roaming"));
        let file = appdata.join("Windsurf/User/settings.json");
        let changed = merge(
            file.clone(),
            serde_json::json!({
                "windsurf.apiKey": relay,
                "windsurf.apiBase": "https://ai.qysyw.cn"
            }),
            dry_run,
            backup,
        )?;
        results.insert(
            "windsurf".into(),
            serde_json::json!({"changed":changed,"path":file}),
        );
    }

    // Cline (formerly Claude Dev)
    if client.is_none() || client == Some("cline") {
        // Cline stores settings in VS Code's settings.json
        let file = home.join(".vscode/settings.json");
        let changed = merge(
            file.clone(),
            serde_json::json!({
                "cline.anthropicApiKey": relay,
                "cline.anthropicBaseUrl": "https://ai.qysyw.cn"
            }),
            dry_run,
            backup,
        )?;
        results.insert(
            "cline".into(),
            serde_json::json!({"changed":changed,"path":file}),
        );
    }

    // Aider
    if client.is_none() || client == Some("aider") {
        let file = home.join(".aider.conf.yml");
        let yaml_content = format!(
            "anthropic-api-key: {}\nanthropic-api-base: https://ai.qysyw.cn\n",
            relay
        );
        if !dry_run {
            if let Some(parent) = file.parent() {
                fs::create_dir_all(parent)?;
            }
            if backup && file.exists() {
                fs::copy(&file, file.with_extension("yml.bak"))?;
            }
            fs::write(&file, yaml_content)?;
        }
        results.insert(
            "aider".into(),
            serde_json::json!({"changed":true,"path":file}),
        );
    }

    Ok(Value::Object(results))
}

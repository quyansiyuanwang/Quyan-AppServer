//! Stable loopback client configs contain only the public compatibility placeholder.
use super::{
    config::{self, RouterConfig, LOCAL_API_KEY, LOCAL_PROVIDER_ID},
    routing::{self, Protocol},
};
use crate::features::integrations::{files, ClientKind};
use anyhow::{bail, ensure, Context, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const DESKTOP_PROFILE_ID: &str = "dfd29f0d-1a0c-4f6c-8d9f-016b29c286b9";
pub const DESKTOP_ALIAS: &str = "claude-sonnet-quyan";

pub fn desktop_directory(home: &Path, env: impl Fn(&str) -> Option<PathBuf>) -> PathBuf {
    if let Some(dir) = env("CLAUDE_DESKTOP_CONFIG_DIR") {
        return dir;
    }
    if cfg!(windows) {
        return env("LOCALAPPDATA")
            .unwrap_or_else(|| home.join("AppData/Local"))
            .join("Claude-3p");
    }
    if cfg!(target_os = "macos") {
        return home.join("Library/Application Support/Claude-3p");
    }
    env("XDG_CONFIG_HOME")
        .unwrap_or_else(|| home.join(".config"))
        .join("Claude-3p")
}
fn target(kind: ClientKind) -> Result<PathBuf> {
    let home = dirs::home_dir().context("Home directory unavailable")?;
    let override_dir = |key: &str| {
        std::env::var_os(key)
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    };
    match kind {
        ClientKind::ClaudeCode=>Ok(override_dir("CLAUDE_CONFIG_DIR").unwrap_or_else(||home.join(".claude")).join("settings.json")),
        ClientKind::Codex=>Ok(override_dir("CODEX_HOME").unwrap_or_else(||home.join(".codex")).join("config.toml")),
        ClientKind::Pi=>Ok(override_dir("PI_CODING_AGENT_DIR").unwrap_or_else(||home.join(".pi/agent")).join("models.json")),
        ClientKind::ClaudeDesktop=>Ok(desktop_directory(&home,override_dir).join("configLibrary")),
        ClientKind::ChatgptDesktop=>bail!("ChatGPT Desktop has no verified configurable local API Endpoint adapter. No official settings or login credentials were modified."),
        _=>bail!("Environment-only clients use quyan launch --router --client {} -- <program>",kind.id()),
    }
}
pub fn apply(kind: ClientKind, model: Option<&str>, dry_run: bool) -> Result<Value> {
    let mut config = config::load()?;
    let target = target(kind)?;
    if kind == ClientKind::ClaudeDesktop {
        let model = model.context(
            "Claude Desktop requires --model; it is mapped to the stable local Sonnet role",
        )?;
        let found = routing::candidates(&config, Protocol::Anthropic, model);
        ensure!(!found.is_empty(),"Model is unavailable through the Anthropic protocol; configure a token translation if needed");
        config
            .routes
            .retain(|r| !(r.protocol == Protocol::Anthropic && r.model == DESKTOP_ALIAS));
        for (priority, candidate) in found.iter().enumerate() {
            config.routes.push(config::RouterRoute {
                protocol: Protocol::Anthropic,
                model: DESKTOP_ALIAS.into(),
                profile_id: candidate.profile_id.clone(),
                upstream_model: Some(candidate.model.clone()),
                priority: priority as i32,
            });
        }
        let preview = apply_at(kind, &target, &config, Some(DESKTOP_ALIAS), true)?;
        if dry_run {
            return Ok(preview);
        }
        // Validate all files before saving the alias, then make it routable
        // before activating the profile. No upstream credential is ever written.
        config::update(|c| {
            c.routes
                .retain(|r| !(r.protocol == Protocol::Anthropic && r.model == DESKTOP_ALIAS));
            c.routes.extend(
                config
                    .routes
                    .iter()
                    .filter(|r| r.protocol == Protocol::Anthropic && r.model == DESKTOP_ALIAS)
                    .cloned(),
            );
            Ok(())
        })?;
        let value = apply_at(kind, &target, &config, Some(DESKTOP_ALIAS), false)?;
        // Application restart is only needed for initial takeover/endpoint change.
        return Ok(value);
    }
    apply_at(kind, &target, &config, model, dry_run)
}
pub(crate) fn apply_at(
    kind: ClientKind,
    path: &Path,
    config: &RouterConfig,
    model: Option<&str>,
    dry_run: bool,
) -> Result<Value> {
    config.validate()?;
    if let Some(model) = model {
        ensure!(config::valid_model(model), "Invalid model ID");
    }
    let base = config.base_url();
    if kind == ClientKind::ClaudeDesktop {
        return desktop(
            path,
            &base,
            model.context("Desktop role model required")?,
            dry_run,
        );
    }
    let original = files::read(path)?;
    let next = match kind {
        ClientKind::ClaudeCode => {
            if let Some(model) = model {
                ensure!(
                    !routing::candidates(config, Protocol::Anthropic, model).is_empty(),
                    "Model unavailable for Anthropic"
                );
            }
            let mut value = files::json_object(original.as_deref())?;
            let env = files::object_entry(&mut value, "env")?;
            env.insert("ANTHROPIC_BASE_URL".into(), json!(base));
            env.insert("ANTHROPIC_AUTH_TOKEN".into(), json!(LOCAL_API_KEY));
            env.remove("ANTHROPIC_API_KEY");
            env.remove("CLAUDE_CODE_OAUTH_TOKEN");
            if let Some(model) = model {
                env.insert("ANTHROPIC_MODEL".into(), json!(model));
            }
            files::serialize_json(&value)?
        }
        ClientKind::Codex => {
            if let Some(model) = model {
                ensure!(
                    !routing::candidates(config, Protocol::OpenaiResponses, model).is_empty(),
                    "Model unavailable for OpenAI Responses"
                );
            }
            let mut doc = original
                .as_deref()
                .unwrap_or("")
                .parse::<toml_edit::DocumentMut>()
                .context("Invalid Codex TOML; no changes made")?;
            doc["model_provider"] = toml_edit::value(LOCAL_PROVIDER_ID);
            if let Some(model) = model {
                doc["model"] = toml_edit::value(model);
            }
            if doc.get("model_providers").is_none() {
                doc["model_providers"] = toml_edit::Item::Table(toml_edit::Table::new());
            }
            let providers = doc["model_providers"]
                .as_table_like_mut()
                .context("Codex providers must be a table")?;
            if !providers.contains_key(LOCAL_PROVIDER_ID) {
                providers.insert(
                    LOCAL_PROVIDER_ID,
                    toml_edit::Item::Table(toml_edit::Table::new()),
                );
            }
            let provider = providers
                .get_mut(LOCAL_PROVIDER_ID)
                .unwrap()
                .as_table_like_mut()
                .context("Quyan provider must be a table")?;
            for name in [
                "env_key",
                "auth",
                "requires_openai_auth",
                "http_headers",
                "env_http_headers",
                "query_params",
            ] {
                provider.remove(name);
            }
            for (key, value) in [
                ("name", "Quyan Local Router"),
                ("base_url", &format!("{base}/v1")),
                ("wire_api", "responses"),
                ("experimental_bearer_token", LOCAL_API_KEY),
            ] {
                provider.insert(key, toml_edit::value(value));
            }
            let mut query = toml_edit::Table::new();
            query["protocol"] = toml_edit::value("openai-responses");
            provider.insert("query_params", toml_edit::Item::Table(query));
            provider.insert("supports_websockets", toml_edit::value(false));
            doc.to_string()
        }
        ClientKind::Pi => {
            let mut value = files::json_object(original.as_deref())?;
            let providers = files::object_entry(&mut value, "providers")?;
            let protocol = match model {
                Some(model) => Protocol::ALL
                    .into_iter()
                    .find(|p| !routing::candidates(config, *p, model).is_empty())
                    .context("Selected pi model unavailable")?,
                None => Protocol::ALL
                    .into_iter()
                    .find(|p| !routing::aggregate_models(config, *p).is_empty())
                    .context("No pi models available; refresh profiles first")?,
            };
            let api = match protocol {
                Protocol::Openai => "openai-completions",
                Protocol::OpenaiResponses => "openai-responses",
                Protocol::Anthropic => "anthropic-messages",
                Protocol::Gemini => "google-generative-ai",
            };
            let url = if matches!(protocol, Protocol::Openai | Protocol::OpenaiResponses) {
                format!("{base}/v1")
            } else {
                base.clone()
            };
            let provider = providers
                .entry(LOCAL_PROVIDER_ID)
                .or_insert(json!({}))
                .as_object_mut()
                .context("pi Quyan provider must be an object")?;
            provider.insert("baseUrl".into(), json!(url));
            provider.insert("api".into(), json!(api));
            provider.insert("apiKey".into(), json!(LOCAL_API_KEY));
            let models = provider
                .entry("models")
                .or_insert(json!([]))
                .as_array_mut()
                .context("pi models must be an array")?;
            for model in routing::aggregate_models(config, protocol) {
                if !models.iter().any(|m| m["id"] == model) {
                    models.push(json!({"id":model}));
                }
            }
            files::serialize_json(&value)?
        }
        _ => bail!("No local Router adapter for this client"),
    };
    let result = files::write(path, original.as_deref(), &next, dry_run, true)?;
    Ok(
        json!({"client":kind.id(),"path":path,"baseUrl":base,"model":model,"changed":result.changed,"dryRun":dry_run,"backup":result.backup,"credential":"public loopback compatibility placeholder; no Relay Token","nextStep":format!("quyan launch --router --client {}",kind.id())}),
    )
}
fn desktop(directory: &Path, base: &str, model: &str, dry_run: bool) -> Result<Value> {
    let profile_path = directory.join(format!("{DESKTOP_PROFILE_ID}.json"));
    let meta_path = directory.join("_meta.json");
    let original = files::read(&profile_path)?;
    let old_meta = files::read(&meta_path)?;
    let mut value = files::json_object(original.as_deref())?;
    let mut meta = files::json_object(old_meta.as_deref())?;
    for (key, val) in [
        ("inferenceProvider", json!("gateway")),
        ("inferenceGatewayAuthScheme", json!("bearer")),
        ("inferenceGatewayApiKey", json!(LOCAL_API_KEY)),
        ("inferenceGatewayBaseUrl", json!(base)),
        ("inferenceModels", json!([model])),
    ] {
        value.insert(key.into(), val);
    }
    let entries = meta
        .entry("entries")
        .or_insert(json!([]))
        .as_array_mut()
        .context("Desktop configLibrary entries must be an array")?;
    if !entries
        .iter()
        .any(|entry| entry["id"] == DESKTOP_PROFILE_ID)
    {
        entries.push(json!({"id":DESKTOP_PROFILE_ID,"name":"Quyan Local Router"}));
    }
    meta.insert("appliedId".into(), json!(DESKTOP_PROFILE_ID));
    let result = files::write(
        &profile_path,
        original.as_deref(),
        &files::serialize_json(&value)?,
        dry_run,
        true,
    )?;
    let meta_result = files::write(
        &meta_path,
        old_meta.as_deref(),
        &files::serialize_json(&meta)?,
        dry_run,
        true,
    )?;
    Ok(
        json!({"client":"claude-desktop","path":profile_path,"metadataPath":meta_path,"baseUrl":base,"model":model,"dryRun":dry_run,"changed":result.changed||meta_result.changed,"backup":result.backup,"metadataBackup":meta_result.backup,"nextStep":"Restart Claude Desktop once after initial takeover. Subsequent Router model/profile switches do not change these files."}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> RouterConfig {
        RouterConfig {
            profiles: vec![config::RouterProfile {
                id: "fixture".into(),
                name: "Fixture".into(),
                relay_token_id: "fixture".into(),
                stack_key: String::new(),
                relay_base_url: "https://relay.example.test".into(),
                enabled: true,
                priority: 0,
                models: config::RouterModels {
                    openai: vec!["model".into()],
                    openai_responses: vec!["model".into()],
                    anthropic: vec!["model".into()],
                    ..Default::default()
                },
                last_models_refresh_at: None,
            }],
            ..Default::default()
        }
    }
    #[test]
    fn client_configs_use_no_relay_secrets_and_preserve_other_settings() {
        let dir = tempfile::tempdir().unwrap();
        for (kind, name, text) in [
            (
                ClientKind::ClaudeCode,
                "settings.json",
                r#"{"env":{"KEEP":"yes"},"permissions":{"allow":["Read"]}}"#,
            ),
            (
                ClientKind::Codex,
                "config.toml",
                "# keep comment\nother = true\n[model_providers.other]\nname = 'Other'\n",
            ),
            (
                ClientKind::Pi,
                "models.json",
                r#"{"providers":{"other":{"models":[{"id":"other-model"}]}}}"#,
            ),
        ] {
            let path = dir.path().join(name);
            std::fs::write(&path, text).unwrap();
            apply_at(kind, &path, &config(), Some("model"), true).unwrap();
            assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
            let result = apply_at(kind, &path, &config(), Some("model"), false).unwrap();
            assert!(result["backup"].is_string());
            let next = std::fs::read_to_string(&path).unwrap();
            assert!(!next.contains("rlt_"));
            assert!(next.contains(LOCAL_API_KEY));
            if kind == ClientKind::Codex {
                assert!(next.contains("# keep comment"));
                assert!(next.contains("model_providers.other"));
            }
            if kind == ClientKind::ClaudeCode {
                assert!(next.contains("KEEP"));
                assert!(next.contains("permissions"));
            }
            if kind == ClientKind::Pi {
                assert!(next.contains("other-model"));
            }
        }
    }
    #[test]
    fn desktop_preserves_other_profiles_and_malformed_metadata_is_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let meta = dir.path().join("_meta.json");
        std::fs::write(&meta, "broken").unwrap();
        assert!(desktop(dir.path(), "http://127.0.0.1:15721", DESKTOP_ALIAS, false).is_err());
        assert!(!dir
            .path()
            .join(format!("{DESKTOP_PROFILE_ID}.json"))
            .exists());
        std::fs::write(
            &meta,
            r#"{"entries":[{"id":"other","name":"Other"}],"appliedId":"other"}"#,
        )
        .unwrap();
        desktop(dir.path(), "http://127.0.0.1:15721", DESKTOP_ALIAS, false).unwrap();
        assert!(std::fs::read_to_string(&meta).unwrap().contains("other"));
    }
}

pub fn binding_status(kind: ClientKind) -> Value {
    let Ok(path) = target(kind) else {
        return json!({"client":kind.id(),"supported":false,"bound":false});
    };
    let Ok(config) = config::load() else {
        return json!({"client":kind.id(),"supported":true,"bound":false});
    };
    let base = config.base_url();
    let file = if kind == ClientKind::ClaudeDesktop {
        path.join(format!("{DESKTOP_PROFILE_ID}.json"))
    } else {
        path.clone()
    };
    let Ok(Some(text)) = files::read(&file) else {
        return json!({"client":kind.id(),"supported":true,"bound":false,"path":file});
    };
    let bound = if kind == ClientKind::Codex {
        text.parse::<toml_edit::DocumentMut>()
            .ok()
            .is_some_and(|doc| {
                doc.get("model_provider").and_then(toml_edit::Item::as_str)
                    == Some(LOCAL_PROVIDER_ID)
                    && doc
                        .get("model_providers")
                        .and_then(toml_edit::Item::as_table_like)
                        .and_then(|providers| providers.get(LOCAL_PROVIDER_ID))
                        .and_then(toml_edit::Item::as_table_like)
                        .and_then(|provider| provider.get("base_url"))
                        .and_then(toml_edit::Item::as_str)
                        == Some(format!("{base}/v1").as_str())
            })
    } else {
        serde_json::from_str::<Value>(&text)
            .ok()
            .is_some_and(|doc| match kind {
                ClientKind::ClaudeCode => doc["env"]["ANTHROPIC_BASE_URL"] == base,
                ClientKind::Pi => doc["providers"][LOCAL_PROVIDER_ID]["baseUrl"]
                    .as_str()
                    .is_some_and(|v| v == base || v == format!("{base}/v1")),
                ClientKind::ClaudeDesktop => doc["inferenceGatewayBaseUrl"]
                    .as_str()
                    .is_some_and(|v| v == base || v == format!("{base}/claude-desktop")),
                _ => false,
            })
    };
    json!({"client":kind.id(),"supported":true,"bound":bound,"path":file})
}

//! Stable loopback client configs contain only the public compatibility placeholder.
use super::{
    config::{self, RouterConfig, LOCAL_API_KEY, LOCAL_PROVIDER_ID},
    routing::{self, Protocol},
};
use crate::features::integrations::{files, ClientKind};
use anyhow::{bail, ensure, Context, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub async fn launch(
    kind: ClientKind,
    model: Option<&str>,
    args: &[std::ffi::OsString],
) -> Result<()> {
    ensure!(
        super::process::status().await?["running"] == true,
        "Router is stopped"
    );
    let config = config::load()?;
    let program = kind
        .executable()
        .context("Router launch supports Claude Code, Codex and pi")?;
    let mut command = std::process::Command::new(
        crate::features::integrations::launch::resolve_program(program.as_ref()),
    );
    let base = config.base_url();
    match kind {
        ClientKind::ClaudeCode => {
            if let Some(model) = model {
                ensure!(
                    !routing::candidates(&config, Protocol::Anthropic, model).is_empty(),
                    "Model unavailable for Anthropic"
                );
            }
            command
                .env("ANTHROPIC_BASE_URL", &base)
                .env("ANTHROPIC_AUTH_TOKEN", LOCAL_API_KEY)
                .env_remove("ANTHROPIC_API_KEY")
                .env_remove("CLAUDE_CODE_OAUTH_TOKEN");
            if let Some(model) = model {
                command.env("ANTHROPIC_MODEL", model);
            }
        }
        ClientKind::Codex => {
            if let Some(model) = model {
                ensure!(
                    !routing::candidates(&config, Protocol::OpenaiResponses, model).is_empty(),
                    "Model unavailable for Responses"
                );
            }
            command
                .arg("-c")
                .arg(format!("model_provider=\"{LOCAL_PROVIDER_ID}\""));
            for (key, value) in [
                ("name", "Quyan Local Router".to_string()),
                ("base_url", format!("{base}/v1")),
                ("wire_api", "responses".into()),
                ("experimental_bearer_token", LOCAL_API_KEY.into()),
            ] {
                command.arg("-c").arg(format!(
                    "model_providers.{LOCAL_PROVIDER_ID}.{key}={}",
                    serde_json::to_string(&value)?
                ));
            }
            command.arg("-c").arg(format!(
                "model_providers.{LOCAL_PROVIDER_ID}.query_params.protocol=\"openai-responses\""
            ));
            command.arg("-c").arg(format!(
                "model_providers.{LOCAL_PROVIDER_ID}.supports_websockets=false"
            ));
            if let Some(model) = model {
                command.arg("--model").arg(model);
            }
        }
        ClientKind::Pi => {
            let text = files::read(&target(kind)?)?.context("Configure pi for Router first")?;
            let document: Value =
                serde_json::from_str(&text).context("Invalid pi configuration")?;
            let model = pi_launch_model(&document, &config, model)?;
            command
                .arg("--provider")
                .arg(LOCAL_PROVIDER_ID)
                .arg("--model")
                .arg(model);
        }
        _ => bail!("Unsupported Router client"),
    }
    command.args(args);
    let status = command
        .status()
        .context("Cannot launch client; check installation and PATH")?;
    ensure!(status.success(), "Client exited unsuccessfully ({status})");
    Ok(())
}

fn pi_api(protocol: Protocol) -> &'static str {
    match protocol {
        Protocol::Openai => "openai-completions",
        Protocol::OpenaiResponses => "openai-responses",
        Protocol::Anthropic => "anthropic-messages",
        Protocol::Gemini => "google-generative-ai",
    }
}
fn pi_launch_model(document: &Value, config: &RouterConfig, model: Option<&str>) -> Result<String> {
    let provider = &document["providers"][LOCAL_PROVIDER_ID];
    let protocol = Protocol::ALL
        .into_iter()
        .find(|protocol| provider["api"] == pi_api(*protocol))
        .context("Configure pi for Router first")?;
    let base = config.base_url();
    let expected_base = if matches!(protocol, Protocol::Openai | Protocol::OpenaiResponses) {
        format!("{base}/v1")
    } else {
        base
    };
    ensure!(
        provider["baseUrl"] == expected_base && provider["apiKey"] == LOCAL_API_KEY,
        "Configure pi for Router first"
    );
    provider["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry["id"].as_str())
        .find(|candidate| {
            model.is_none_or(|model| *candidate == model)
                && !routing::candidates(config, protocol, candidate).is_empty()
        })
        .map(str::to_owned)
        .context(
            "Model unavailable in the current pi configuration; configure pi with this model first",
        )
}

fn target(kind: ClientKind) -> Result<PathBuf> {
    crate::features::integrations::config_path(kind)
}
pub fn apply(kind: ClientKind, model: Option<&str>, dry_run: bool) -> Result<Value> {
    let config = config::load()?;
    let target = target(kind)?;
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
            let api = pi_api(protocol);
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
            let available = routing::aggregate_models(config, protocol);
            models.retain(|entry| {
                entry["id"]
                    .as_str()
                    .is_some_and(|model| available.iter().any(|available| available == model))
            });
            for model in available {
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
    fn pi_protocol_switch_removes_stale_models_and_checks_launch_compatibility() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("models.json");
        let mut config = config();
        config.profiles[0].models.anthropic = vec!["claude-fixture".into()];
        apply_at(ClientKind::Pi, &path, &config, Some("model"), false).unwrap();
        let document: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(pi_launch_model(&document, &config, None).unwrap(), "model");
        assert!(pi_launch_model(&document, &config, Some("claude-fixture")).is_err());

        apply_at(
            ClientKind::Pi,
            &path,
            &config,
            Some("claude-fixture"),
            false,
        )
        .unwrap();
        let mut document: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            document["providers"][LOCAL_PROVIDER_ID]["api"],
            "anthropic-messages"
        );
        assert_eq!(
            document["providers"][LOCAL_PROVIDER_ID]["models"],
            json!([{"id":"claude-fixture"}])
        );
        assert_eq!(
            pi_launch_model(&document, &config, None).unwrap(),
            "claude-fixture"
        );
        assert!(pi_launch_model(&document, &config, Some("model")).is_err());
        document["providers"][LOCAL_PROVIDER_ID]["baseUrl"] = json!("https://example.test");
        assert!(pi_launch_model(&document, &config, None).is_err());
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
    let file = path.clone();
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
                _ => false,
            })
    };
    json!({"client":kind.id(),"supported":true,"bound":bound,"path":file})
}

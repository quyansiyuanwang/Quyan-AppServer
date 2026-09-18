//! Client adapters own their protocol keys; endpoint values come from Quyan config.
//! Credentials stay in the OS keychain and are injected only into launched children.
mod files;
mod launch;
pub use launch::launch;

use anyhow::{bail, ensure, Context, Result};
use clap::ValueEnum;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const RELAY_KEY_ENV: &str = "QUYAN_RELAY_API_KEY";
const PROVIDER_ID: &str = "quyan";

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum ClientKind {
    ClaudeCode,
    Codex,
    Pi,
    /// Environment-only adapter for a user-specified OpenAI-compatible harness.
    Openai,
    /// Environment-only adapter for a user-specified Anthropic-compatible harness.
    Anthropic,
}

impl ClientKind {
    pub fn id(self) -> String {
        self.to_possible_value().unwrap().get_name().to_string()
    }
    pub fn configurable() -> Vec<Self> {
        Self::value_variants()
            .iter()
            .copied()
            .filter(|kind| !matches!(kind, Self::Openai | Self::Anthropic))
            .collect()
    }
    pub fn executable(self) -> Option<&'static str> {
        match self {
            Self::ClaudeCode => Some("claude"),
            Self::Codex => Some("codex"),
            Self::Pi => Some("pi"),
            _ => None,
        }
    }
}

pub fn endpoint(base: &str, versioned: bool) -> Result<String> {
    let mut url = crate::core::endpoints::validate_endpoint(base)?;
    let path = url
        .path()
        .trim_end_matches('/')
        .trim_end_matches("/v1")
        .to_string();
    url.set_path(&format!("{path}{}", if versioned { "/v1" } else { "" }));
    Ok(url.to_string().trim_end_matches('/').to_string())
}

fn target(home: &Path, kind: ClientKind, env: impl Fn(&str) -> Option<PathBuf>) -> Result<PathBuf> {
    let (variable, fallback, filename) = match kind {
        ClientKind::ClaudeCode => ("CLAUDE_CONFIG_DIR", ".claude", "settings.json"),
        ClientKind::Codex => ("CODEX_HOME", ".codex", "config.toml"),
        ClientKind::Pi => ("PI_CODING_AGENT_DIR", ".pi/agent", "models.json"),
        _ => bail!(
            "This is an environment-only adapter; use quyan launch --client {} -- <program>",
            kind.id()
        ),
    };
    Ok(env(variable)
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| home.join(fallback))
        .join(filename))
}

pub fn apply(
    kind: ClientKind,
    base: &str,
    model: Option<&str>,
    dry_run: bool,
    backup: bool,
) -> Result<Value> {
    let home = dirs::home_dir().context("home directory is unavailable")?;
    let file = target(&home, kind, |name| {
        std::env::var_os(name).map(PathBuf::from)
    })?;
    apply_at(kind, &file, base, model, dry_run, backup)
}

fn apply_at(
    kind: ClientKind,
    file: &Path,
    base: &str,
    model: Option<&str>,
    dry_run: bool,
    backup: bool,
) -> Result<Value> {
    let model = model.map(str::trim).filter(|value| !value.is_empty());
    if let Some(model) = model {
        ensure!(!model.chars().any(char::is_control), "invalid model id");
    }
    let base = endpoint(base, kind != ClientKind::ClaudeCode)?;
    let current = files::read(file)?;
    let next = match kind {
        ClientKind::ClaudeCode => {
            let mut value = files::json_object(current.as_deref())?;
            let env = files::object_entry(&mut value, "env")?;
            env.insert("ANTHROPIC_BASE_URL".into(), json!(base));
            if let Some(model) = model {
                env.insert("ANTHROPIC_MODEL".into(), json!(model));
            }
            files::serialize_json(&value)?
        }
        ClientKind::Pi => {
            let model = model.context(
                "pi requires --model from your Relay model catalog; no model is guessed",
            )?;
            let mut value = files::json_object(current.as_deref())?;
            let providers = files::object_entry(&mut value, "providers")?;
            let provider = providers
                .entry(PROVIDER_ID)
                .or_insert(json!({}))
                .as_object_mut()
                .context("pi provider must be an object")?;
            provider.insert("baseUrl".into(), json!(base));
            provider.insert("api".into(), json!("openai-completions"));
            provider.insert("apiKey".into(), json!(format!("${RELAY_KEY_ENV}")));
            let models = provider
                .entry("models")
                .or_insert(json!([]))
                .as_array_mut()
                .context("pi models must be an array")?;
            if !models.iter().any(|item| item["id"] == model) {
                models.push(json!({"id":model}));
            }
            files::serialize_json(&value)?
        }
        ClientKind::Codex => {
            let mut doc = current
                .as_deref()
                .unwrap_or("")
                .parse::<toml_edit::DocumentMut>()
                .map_err(|_| {
                    anyhow::anyhow!("Invalid TOML; existing client configuration was not changed")
                })?;
            doc["model_provider"] = toml_edit::value(PROVIDER_ID);
            if let Some(model) = model {
                doc["model"] = toml_edit::value(model);
            }
            if doc.get("model_providers").is_none() {
                doc["model_providers"] = toml_edit::Item::Table(toml_edit::Table::new());
            }
            let providers = doc["model_providers"]
                .as_table_like_mut()
                .context("model_providers must be a table")?;
            if !providers.contains_key(PROVIDER_ID) {
                providers.insert(PROVIDER_ID, toml_edit::Item::Table(toml_edit::Table::new()));
            }
            let provider = providers
                .get_mut(PROVIDER_ID)
                .unwrap()
                .as_table_like_mut()
                .context("Quyan provider must be a table")?;
            // These auth modes conflict with env_key; only touch our own provider.
            for key in ["auth", "experimental_bearer_token", "requires_openai_auth"] {
                provider.remove(key);
            }
            for (key, value) in codex_provider(&base) {
                provider.insert(key, toml_edit::value(value));
            }
            doc.to_string()
        }
        _ => bail!("No config-file adapter for {}", kind.id()),
    };
    let result = files::write(file, current.as_deref(), &next, dry_run, backup)?;
    Ok(
        json!({"client": kind.id(), "path": file, "baseUrl":base, "model":model, "changed": result.changed, "dryRun":dry_run, "backup":result.backup, "credentials":"system-keychain; injected by quyan launch", "nextStep":format!("quyan launch --client {}",kind.id())}),
    )
}

fn codex_provider(versioned_base: &str) -> [(&'static str, &str); 4] {
    [
        ("name", "Quyan Relay"),
        ("base_url", versioned_base),
        ("env_key", RELAY_KEY_ENV),
        ("wire_api", "responses"),
    ]
}

pub fn catalog() -> Value {
    json!(ClientKind::value_variants().iter().map(|kind| json!({"client":kind.id(), "configFile": kind.executable().is_some(), "credentialStorage":"system-keychain"})).collect::<Vec<_>>())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[test]
    fn urls_derive_from_config_without_double_version_or_embedded_secrets() {
        assert_eq!(
            endpoint("https://relay.example.test/prefix/v1/", true).unwrap(),
            "https://relay.example.test/prefix/v1"
        );
        assert_eq!(
            endpoint("https://relay.example.test/v1", false).unwrap(),
            "https://relay.example.test"
        );
        for url in [
            "http://remote.test",
            "https://user:secret@relay.test",
            "https://relay.test?key=secret",
            "file:///tmp/test",
        ] {
            assert!(endpoint(url, true).is_err());
        }
    }
    #[test]
    fn respects_tool_config_directory_overrides() {
        let path = target(Path::new("unused"), ClientKind::Codex, |_| {
            Some(PathBuf::from("custom"))
        })
        .unwrap();
        assert_eq!(path, PathBuf::from("custom/config.toml"));
    }
    #[test]
    fn preserves_claude_environment_and_never_writes_a_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(
            &path,
            r#"{"env":{"KEEP":"yes"},"permissions":{"allow":["Read"]}}"#,
        )
        .unwrap();
        let preview = apply_at(
            ClientKind::ClaudeCode,
            &path,
            "https://relay.test",
            None,
            true,
            true,
        )
        .unwrap();
        assert!(preview["changed"].as_bool().unwrap());
        assert!(!fs::read_to_string(&path)
            .unwrap()
            .contains("ANTHROPIC_BASE_URL"));
        apply_at(
            ClientKind::ClaudeCode,
            &path,
            "https://relay.test",
            None,
            false,
            true,
        )
        .unwrap();
        let value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["env"]["KEEP"], "yes");
        assert_eq!(value["permissions"]["allow"][0], "Read");
        assert!(value["env"].get("ANTHROPIC_AUTH_TOKEN").is_none());
        assert_eq!(
            apply_at(
                ClientKind::ClaudeCode,
                &path,
                "https://relay.test",
                None,
                false,
                true
            )
            .unwrap()["changed"],
            false
        );
    }
    #[test]
    fn codex_uses_toml_and_preserves_comments_and_other_providers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(
            &path,
            "# user comment\nmodel = \"user-model\"\n[model_providers.other]\nname = \"Other\"\n",
        )
        .unwrap();
        apply_at(
            ClientKind::Codex,
            &path,
            "https://relay.test",
            None,
            false,
            true,
        )
        .unwrap();
        let text = fs::read_to_string(&path).unwrap();
        let doc = text.parse::<toml_edit::DocumentMut>().unwrap();
        assert!(text.contains("# user comment"));
        assert_eq!(doc["model"].as_str(), Some("user-model"));
        assert_eq!(
            doc["model_providers"]["other"]["name"].as_str(),
            Some("Other")
        );
        assert_eq!(
            doc["model_providers"][PROVIDER_ID]["env_key"].as_str(),
            Some(RELAY_KEY_ENV)
        );
        assert_eq!(
            doc["model_providers"][PROVIDER_ID]["base_url"].as_str(),
            Some("https://relay.test/v1")
        );
    }
    #[test]
    fn pi_requires_a_model_and_merges_without_removing_existing_models() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("models.json");
        assert!(apply_at(
            ClientKind::Pi,
            &path,
            "https://relay.test",
            None,
            false,
            true
        )
        .is_err());
        for model in ["test-model-a", "test-model-b", "test-model-a"] {
            apply_at(
                ClientKind::Pi,
                &path,
                "https://relay.test",
                Some(model),
                false,
                true,
            )
            .unwrap();
        }
        let value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            value["providers"][PROVIDER_ID]["models"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            value["providers"][PROVIDER_ID]["apiKey"],
            format!("${RELAY_KEY_ENV}")
        );
    }
    #[test]
    fn malformed_toml_and_wrong_provider_shapes_never_panic_or_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        for text in [
            "[bad",
            "model_providers = 5",
            "[model_providers]\nquyan = 5",
        ] {
            std::fs::write(&path, text).unwrap();
            assert!(apply_at(
                ClientKind::Codex,
                &path,
                "https://relay.test",
                None,
                false,
                true
            )
            .is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
        }
    }

    #[test]
    fn malformed_configs_are_not_overwritten_even_in_dry_run() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.json");
        for original in ["{bad json", "[]", r#"{"env":[]}"#] {
            fs::write(&path, original).unwrap();
            assert!(apply_at(
                ClientKind::ClaudeCode,
                &path,
                "https://relay.test",
                None,
                false,
                true
            )
            .is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), original);
        }
    }
}

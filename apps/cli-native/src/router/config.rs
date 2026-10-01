//! Non-sensitive routing configuration; credential values never belong in this file.
use anyhow::{ensure, Context, Result};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    net::IpAddr,
    path::{Path, PathBuf},
};

pub const DEFAULT_LISTEN_ADDRESS: &str = "127.0.0.1";
pub const DEFAULT_LISTEN_PORT: u16 = 15721;
// A compatibility placeholder, NOT an authentication secret. Browser requests
// are rejected by the server; administrative requests use a separate nonce.
pub const LOCAL_API_KEY: &str = "quyan-local-router";
pub const LOCAL_KEY_ENV: &str = "QUYAN_PROXY_API_KEY";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RouterConfig {
    pub version: u32,
    pub listen_address: String,
    pub listen_port: u16,
    pub active: bool,
    #[serde(default)]
    pub stack_enabled: bool,
    #[serde(default)]
    pub profiles: Vec<RouterProfile>,
    #[serde(default)]
    pub routes: Vec<RouterRoute>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RouterProfile {
    pub id: String,
    pub name: String,
    pub relay_token_id: String,
    /// Stable human-readable key used in Stack model IDs.
    #[serde(default)]
    pub stack_key: String,
    pub relay_base_url: String,
    pub enabled: bool,
    pub priority: i32,
    #[serde(default)]
    pub models: RouterModels,
    #[serde(default)]
    pub last_models_refresh_at: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RouterModels {
    #[serde(default)]
    pub openai: Vec<String>,
    // Unlike the existing API's `openai` list, this is Responses-specific.
    // It is derived from the authorized routing catalog, never guessed from a name.
    #[serde(default)]
    pub openai_responses: Vec<String>,
    #[serde(default)]
    pub anthropic: Vec<String>,
    #[serde(default)]
    pub gemini: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RouterRoute {
    pub protocol: super::routing::Protocol,
    pub model: String,
    pub profile_id: String,
    pub upstream_model: Option<String>,
    pub priority: i32,
}

impl Default for RouterConfig {
    fn default() -> Self {
        Self {
            version: 1,
            listen_address: DEFAULT_LISTEN_ADDRESS.into(),
            listen_port: DEFAULT_LISTEN_PORT,
            active: true,
            stack_enabled: false,
            profiles: Vec::new(),
            routes: Vec::new(),
        }
    }
}

pub fn valid_stack_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
pub fn slug_stack_key(value: &str) -> String {
    let mut result = String::new();
    for ch in value.chars() {
        let ch = ch.to_ascii_lowercase();
        if ch.is_ascii_lowercase() || ch.is_ascii_digit() {
            result.push(ch);
        } else if !result.is_empty() && !result.ends_with('-') {
            result.push('-');
        }
        if result.len() >= 24 {
            break;
        }
    }
    result.trim_matches('-').to_string()
}
pub fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
pub fn valid_model(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
}

impl RouterConfig {
    pub fn address(&self) -> String {
        match self.listen_address.parse::<IpAddr>() {
            Ok(IpAddr::V6(_)) => format!("[{}]:{}", self.listen_address, self.listen_port),
            _ => format!("{}:{}", self.listen_address, self.listen_port),
        }
    }
    pub fn base_url(&self) -> String {
        format!("http://{}", self.address())
    }
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.version == 1,
            "Unsupported router configuration version"
        );
        ensure!(
            self.listen_address
                .parse::<IpAddr>()
                .is_ok_and(|ip| ip.is_loopback()),
            "Router must bind to a loopback IP address"
        );
        ensure!(
            self.listen_port >= 1024,
            "Router port must be between 1024 and 65535"
        );
        let mut ids = HashSet::new();
        for profile in &self.profiles {
            ensure!(
                valid_id(&profile.id) && ids.insert(&profile.id),
                "Invalid or duplicate router profile ID"
            );
            ensure!(valid_id(&profile.relay_token_id), "Invalid Relay Token ID");
            if !profile.stack_key.is_empty() {
                ensure!(
                    valid_stack_key(&profile.stack_key),
                    "Invalid router stack key"
                );
            }
            ensure!(
                !profile.name.is_empty() && !profile.name.chars().any(char::is_control),
                "Invalid router profile name"
            );
            crate::core::endpoints::validate_endpoint(&profile.relay_base_url)
                .context("Invalid Relay endpoint")?;
            for protocol in super::routing::Protocol::ALL {
                ensure!(
                    protocol
                        .models(&profile.models)
                        .iter()
                        .all(|m| valid_model(m) && !m.contains('*')),
                    "Invalid catalog model ID"
                );
            }
        }
        let mut route_ids = HashSet::new();
        for route in &self.routes {
            ensure!(valid_model(&route.model), "Invalid route model");
            ensure!(
                !route.model.contains('*')
                    || (route.model.ends_with('*') && route.model.matches('*').count() == 1),
                "Only a trailing wildcard is supported"
            );
            ensure!(
                ids.contains(&route.profile_id),
                "Route references an unknown profile"
            );
            ensure!(
                route_ids.insert((route.protocol, &route.model, &route.profile_id)),
                "Duplicate router route"
            );
            ensure!(
                route
                    .upstream_model
                    .as_ref()
                    .is_none_or(|m| valid_model(m) && !m.contains('*')),
                "Invalid upstream model"
            );
        }
        Ok(())
    }
}

pub fn path() -> PathBuf {
    crate::core::config::directory().join("router.json")
}
pub fn load_at(path: &Path) -> Result<RouterConfig> {
    let value = match crate::features::integrations::files::read(path)? {
        Some(text) => serde_json::from_str(&text)
            .context("Invalid router configuration; previous snapshot remains active")?,
        None => RouterConfig::default(),
    };
    value.validate()?;
    Ok(value)
}
pub fn load() -> Result<RouterConfig> {
    load_at(&path())
}

/// Serializes cooperating CLI/TUI mutations and checks the pre-write snapshot.
pub fn update_at<T>(path: &Path, edit: impl FnOnce(&mut RouterConfig) -> Result<T>) -> Result<T> {
    let parent = path.parent().context("Missing router config directory")?;
    fs::create_dir_all(parent)?;
    let lock_path = path.with_extension("lock");
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(lock_path)?;
    lock.lock_exclusive()?;
    let original = crate::features::integrations::files::read(path)?;
    let mut config = load_at(path)?;
    let result = edit(&mut config)?;
    config.validate()?;
    let next = format!("{}\n", serde_json::to_string_pretty(&config)?);
    crate::features::integrations::files::write(path, original.as_deref(), &next, false, true)?;
    Ok(result)
}
pub fn update<T>(edit: impl FnOnce(&mut RouterConfig) -> Result<T>) -> Result<T> {
    update_at(&path(), edit)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_are_compatible_and_loopback_only() {
        let config = RouterConfig::default();
        assert_eq!(config.base_url(), "http://127.0.0.1:15721");
        let text = serde_json::to_string(&config).unwrap();
        assert!(text.contains("listenAddress"));
        assert_eq!(serde_json::from_str::<RouterConfig>(&text).unwrap(), config);
        for address in ["0.0.0.0", "192.168.1.2", "localhost"] {
            assert!(RouterConfig {
                listen_address: address.into(),
                ..config.clone()
            }
            .validate()
            .is_err());
        }
    }
    #[test]
    fn malformed_configuration_is_never_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("router.json");
        fs::write(&path, "broken").unwrap();
        assert!(update_at(&path, |c| {
            c.active = false;
            Ok(())
        })
        .is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "broken");
    }
    #[test]
    fn updates_make_backups_and_retain_other_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("router.json");
        update_at(&path, |c| {
            c.listen_port = 15722;
            Ok(())
        })
        .unwrap();
        update_at(&path, |c| {
            c.active = false;
            Ok(())
        })
        .unwrap();
        assert_eq!(load_at(&path).unwrap().listen_port, 15722);
        assert!(fs::read_dir(dir.path()).unwrap().any(|e| e
            .unwrap()
            .path()
            .extension()
            .is_some_and(|e| e == "bak")));
    }
}

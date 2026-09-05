use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

use crate::credentials::Credentials;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Config {
    pub version: u32,
    pub locale: String,
    pub api_base_url: String,
    pub relay_base_url: String,
    #[serde(default = "default_auth_base_url")]
    pub auth_base_url: String,
    #[serde(default)]
    pub metadata: serde_json::Map<String, serde_json::Value>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: 1,
            locale: "zh-CN".into(),
            api_base_url: "https://api.qysyw.cn".into(),
            relay_base_url: "https://ai.qysyw.cn".into(),
            auth_base_url: "https://auth.qysyw.cn".into(),
            metadata: serde_json::Map::new(),
        }
    }
}

fn default_auth_base_url() -> String {
    "https://auth.qysyw.cn".into()
}

pub fn directory() -> PathBuf {
    std::env::var_os("QUYAN_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::config_dir().map(|p| p.join("quyan")))
        .unwrap_or_else(|| PathBuf::from(".quyan"))
}
pub fn path() -> PathBuf {
    directory().join("config.json")
}

pub fn load() -> Result<Config> {
    let file = path();
    if !file.exists() {
        return Ok(Config::default());
    }
    let value = serde_json::from_slice(&fs::read(&file).context("failed to read config")?)?;
    Ok(value)
}

pub fn save(config: &Config) -> Result<()> {
    fs::create_dir_all(directory())?;
    let target = path();
    let temp = target.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(
        &temp,
        format!("{}\n", serde_json::to_string_pretty(config)?),
    )?;
    fs::rename(temp, target).context("failed to atomically write config")
}

pub fn reset() -> Result<()> {
    let _ = fs::remove_file(path());
    crate::credentials::clear()
}

pub fn masked(config: &Config, credentials: &Credentials) -> serde_json::Value {
    serde_json::json!({
        "version": config.version,
        "locale": config.locale,
        "apiBaseUrl": config.api_base_url,
        "relayBaseUrl": config.relay_base_url,
        "authBaseUrl": config.auth_base_url,
        "metadata": config.metadata,
        "credentials": {
            "accessToken": credentials.access_token.as_deref().map(crate::credentials::mask),
            "refreshToken": credentials.refresh_token.as_deref().map(crate::credentials::mask),
            "accessKey": credentials.access_key.as_deref().map(crate::credentials::mask),
            "relayToken": credentials.relay_token.as_deref().map(crate::credentials::mask),
            "productKey": credentials.product_key.as_deref().map(crate::credentials::mask),
        }
    })
}

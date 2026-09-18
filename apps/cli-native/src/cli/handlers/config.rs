use anyhow::Result;
use serde_json::json;

use crate::cli::ConfigCommand;
use crate::core::{config, credentials::Credentials};

pub fn handle_config(
    command: ConfigCommand,
    cfg: &mut config::Config,
    creds: &Credentials,
    json_output: bool,
) -> Result<()> {
    match command {
        ConfigCommand::Get => super::common::print_value(config::masked(cfg, creds), json_output),
        ConfigCommand::Set { key, value } => {
            set_value(cfg, &key, &value)?;
            config::save(cfg)?;
            super::common::print_value(json!({"key":key,"value":value}), json_output)
        }
        ConfigCommand::Reset => {
            config::reset()?;
            super::common::print_value(json!({"reset":true}), json_output)
        }
    }
}

fn set_value(cfg: &mut config::Config, key: &str, value: &str) -> Result<()> {
    match key {
        "apiBaseUrl" | "api_base_url" | "relayBaseUrl" | "relay_base_url" | "authBaseUrl" | "auth_base_url" => {
            let url = crate::core::endpoints::validate_endpoint(value)?;
            let value = url.as_str().trim_end_matches('/').to_owned();
            match key {
                "apiBaseUrl" | "api_base_url" => cfg.api_base_url = value,
                "relayBaseUrl" | "relay_base_url" => cfg.relay_base_url = value,
                _ => cfg.auth_base_url = value,
            }
        }
        "locale" => {
            anyhow::ensure!(matches!(value, "zh-CN" | "en-US"), "Unsupported locale");
            cfg.locale = value.into();
        }
        _ => anyhow::bail!("Unknown setting. Supported keys: apiBaseUrl, relayBaseUrl, authBaseUrl, locale. Import credentials through stdin, not config set."),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn relay_address_updates_the_runtime_field_instead_of_metadata() {
        let mut config = config::Config::default();
        set_value(&mut config, "relayBaseUrl", "https://relay.example.test/").unwrap();
        assert_eq!(config.relay_base_url, "https://relay.example.test");
        assert!(config.metadata.is_empty());
        for (key, value) in [
            ("relayBaseUrl", "https://user:secret@example.test"),
            ("token", "test"),
            ("relayBaseUrl", "javascript:bad"),
            ("relayBaseUrl", "http://example.test"),
        ] {
            assert!(set_value(&mut config, key, value).is_err());
        }
    }
}

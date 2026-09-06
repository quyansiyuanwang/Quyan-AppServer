use anyhow::Result;
use serde_json::{json, Value};

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
            cfg.metadata
                .insert(key.clone(), Value::String(value.clone()));
            config::save(cfg)?;
            super::common::print_value(json!({"key":key,"value":value}), json_output)
        }
        ConfigCommand::Reset => {
            config::reset()?;
            super::common::print_value(json!({"reset":true}), json_output)
        }
    }
}

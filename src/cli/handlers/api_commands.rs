use anyhow::Result;
use serde_json::{json, Value};
use std::io::Read;

use crate::core::api::ApiClient;
use crate::services::{account, relay, json_endpoint_product as product};

pub async fn handle_account(api: &ApiClient, json_output: bool) -> Result<()> {
    let value = json!({
        "profile": account::profile(api).await?,
        "balance": account::balance(api).await?,
        "usage": account::usage(api).await?
    });
    super::common::print_value(value, json_output)
}

pub async fn handle_relay_command(
    command: super::super::RelayCommand,
    api: &ApiClient,
    json_output: bool,
) -> Result<()> {
    let value = match command {
        super::super::RelayCommand::Token { command } => match command {
            super::super::RelayTokenCommand::List => relay::tokens(api).await?,
            super::super::RelayTokenCommand::Create => relay::create_token(api).await?,
            super::super::RelayTokenCommand::Update { id } => {
                relay::update_token(api, &id, read_json_stdin()?).await?
            }
            super::super::RelayTokenCommand::Delete { id } => relay::delete_token(api, &id).await?,
            super::super::RelayTokenCommand::Usage { id } => relay::token_usage(api, &id).await?,
        },
        super::super::RelayCommand::Channels {
            command: super::super::ChannelsCommand::List,
        } => relay::channels(api).await?,
    };
    super::common::print_value(value, json_output)
}

pub async fn handle_product_command(
    command: super::super::ProductCommand,
    api: &ApiClient,
    json_output: bool,
) -> Result<()> {
    let value = match command {
        super::super::ProductCommand::JsonEndpoints { command } => match command {
            super::super::ProductJsonCommand::Get => product::get(api).await?,
            super::super::ProductJsonCommand::Update { file } => {
                product::update(api, serde_json::from_slice(&std::fs::read(file)?)?).await?
            }
            super::super::ProductJsonCommand::Clear => product::clear(api).await?,
            super::super::ProductJsonCommand::Usage => product::usage(api).await?,
        },
    };
    super::common::print_value(value, json_output)
}

fn read_json_stdin() -> Result<Value> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    Ok(serde_json::from_str(&input)?)
}

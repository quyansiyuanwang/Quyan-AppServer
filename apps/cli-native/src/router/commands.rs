use super::{
    config, process, profiles,
    routing::{self, Protocol},
};
use anyhow::{ensure, Result};
use clap::Subcommand;
use serde_json::{json, Value};
use std::io::{self, IsTerminal, Write};

#[derive(Debug, Subcommand)]
pub enum RouterCommand {
    Start,
    Stop,
    Status,
    Reload,
    #[command(hide = true)]
    Serve,
    Models {
        #[arg(long)]
        refresh: bool,
    },
    Profile {
        #[command(subcommand)]
        command: ProfileCommand,
    },
    Route {
        #[command(subcommand)]
        command: RouteCommand,
    },
    Stack {
        #[command(subcommand)]
        command: StackCommand,
    },
    Apply {
        #[arg(long, value_enum)]
        client: crate::features::integrations::ClientKind,
        #[arg(long)]
        model: Option<String>,
        #[arg(long)]
        dry_run: bool,
    },
}
#[derive(Debug, Subcommand)]
pub enum ProfileCommand {
    List,
    Add {
        #[arg(long)]
        token_id: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long, default_value_t = 0)]
        priority: i32,
    },
    Remove {
        id: String,
    },
    Set {
        id: String,
        #[arg(long)]
        priority: Option<i32>,
        #[arg(long)]
        enabled: Option<bool>,
        #[arg(long)]
        name: Option<String>,
    },
}
#[derive(Debug, Subcommand)]
pub enum StackCommand {
    Status,
    Enable,
    Disable,
}
#[derive(Debug, Subcommand)]
pub enum RouteCommand {
    List,
    Set {
        #[arg(long, value_enum)]
        protocol: Protocol,
        #[arg(long)]
        model: String,
        #[arg(long)]
        profile: String,
        #[arg(long)]
        upstream_model: Option<String>,
        #[arg(long, default_value_t = 0)]
        priority: i32,
    },
    Remove {
        #[arg(long, value_enum)]
        protocol: Protocol,
        #[arg(long)]
        model: String,
        #[arg(long)]
        profile: Option<String>,
    },
}
fn confirm(yes: bool, target: &str) -> Result<()> {
    if yes {
        return Ok(());
    }
    ensure!(
        io::stdin().is_terminal(),
        "Router write requires --yes outside an interactive terminal"
    );
    eprint!("{target}\nConfirm / 确认 [y/N]: ");
    io::stderr().flush()?;
    let mut answer = String::new();
    io::stdin().read_line(&mut answer)?;
    ensure!(
        answer.trim().eq_ignore_ascii_case("y"),
        "Cancelled; no changes made"
    );
    Ok(())
}
fn api(cfg: &crate::core::config::Config) -> Result<crate::core::api::ApiClient> {
    crate::core::api::ApiClient::with_endpoints(
        crate::core::credentials::load()?,
        &cfg.locale,
        &cfg.api_base_url,
        &cfg.relay_base_url,
    )
}
pub async fn run(
    command: RouterCommand,
    yes: bool,
    cfg: &crate::core::config::Config,
) -> Result<Option<Value>> {
    let value = match command {
        RouterCommand::Start => {
            confirm(yes, "Start the local loopback Router?")?;
            process::start().await?
        }
        RouterCommand::Stop => {
            confirm(
                yes,
                "Stop Router? Connected agents cannot request models until it is restarted.",
            )?;
            process::stop().await?
        }
        RouterCommand::Status => process::status().await?,
        RouterCommand::Reload => {
            confirm(yes, "Reload Router configuration?")?;
            process::reload().await?
        }
        RouterCommand::Serve => {
            process::serve().await?;
            return Ok(None);
        }
        RouterCommand::Models { refresh } => {
            if refresh {
                confirm(yes, "Refresh saved Relay model catalogs?")?;
                profiles::refresh(&api(cfg)?).await?;
                process::reload_if_running().await?;
            }
            let config = config::load()?;
            json!({"stackEnabled":config.stack_enabled,"profiles":config.profiles,"models":Protocol::ALL.iter().map(|p| (p.as_str().into(),json!(routing::aggregate_models(&config,*p)))).collect::<serde_json::Map<String,Value>>()})
        }
        RouterCommand::Profile { command } => {
            match command {
                ProfileCommand::List => json!(config::load()?.profiles),
                ProfileCommand::Add {
                    token_id,
                    name,
                    priority,
                } => {
                    confirm(yes,&format!("Save Relay Token {token_id} as a Router profile in the system keychain?"))?;
                    let profile =
                        profiles::add(&api(cfg)?, &token_id, name.as_deref(), priority).await?;
                    process::reload_if_running().await?;
                    json!({"profile":profile,"credentialStorage":"system-keychain"})
                }
                ProfileCommand::Remove { id } => {
                    confirm(
                        yes,
                        &format!("Remove profile {id}, its routes and keychain entry?"),
                    )?;
                    profiles::remove(&id)?;
                    process::reload_if_running().await?;
                    json!({"removed":id})
                }
                ProfileCommand::Set {
                    id,
                    priority,
                    enabled,
                    name,
                } => {
                    confirm(yes, &format!("Update Router profile {id}?"))?;
                    config::update(|c| {
                        let p = c
                            .profiles
                            .iter_mut()
                            .find(|p| p.id == id)
                            .ok_or_else(|| anyhow::anyhow!("Unknown Router profile"))?;
                        if let Some(priority) = priority {
                            p.priority = priority;
                        }
                        if let Some(enabled) = enabled {
                            p.enabled = enabled;
                        }
                        if let Some(name) = name {
                            p.name = name;
                        }
                        Ok(())
                    })?;
                    process::reload_if_running().await?;
                    json!({"updated":id})
                }
            }
        }
        RouterCommand::Route { command } => match command {
            RouteCommand::List => json!(config::load()?.routes),
            RouteCommand::Set {
                protocol,
                model,
                profile,
                upstream_model,
                priority,
            } => {
                confirm(
                    yes,
                    &format!(
                        "Route {} / {model} to profile {profile}, upstream {}?",
                        protocol.as_str(),
                        upstream_model.as_deref().unwrap_or(&model)
                    ),
                )?;
                config::update(|c| {
                    let p = c
                        .profiles
                        .iter()
                        .find(|p| p.id == profile)
                        .ok_or_else(|| anyhow::anyhow!("Unknown profile"))?;
                    if let Some(upstream) = upstream_model.as_ref() {
                        ensure!(
                            protocol.models(&p.models).contains(upstream),
                            "Upstream model is unavailable for this protocol/profile"
                        );
                    } else if !model.contains('*') {
                        ensure!(
                            protocol.models(&p.models).contains(&model),
                            "Model is unavailable for this protocol/profile"
                        );
                    }
                    c.routes.retain(|r| {
                        !(r.protocol == protocol
                            && r.model == model
                            && (r.profile_id == profile || r.priority == priority))
                    });
                    c.routes.push(config::RouterRoute {
                        protocol,
                        model: model.clone(),
                        profile_id: profile,
                        upstream_model,
                        priority,
                    });
                    Ok(())
                })?;
                process::reload_if_running().await?;
                json!({"updated":model})
            }
            RouteCommand::Remove {
                protocol,
                model,
                profile,
            } => {
                confirm(
                    yes,
                    &format!("Remove {} / {model} routing rule?", protocol.as_str()),
                )?;
                config::update(|c| {
                    c.routes.retain(|r| {
                        !(r.protocol == protocol
                            && r.model == model
                            && profile.as_ref().is_none_or(|id| *id == r.profile_id))
                    });
                    Ok(())
                })?;
                process::reload_if_running().await?;
                json!({"removed":model})
            }
        },
        RouterCommand::Stack { command } => match command {
            StackCommand::Status => {
                let config = config::load()?;
                json!({"enabled":config.stack_enabled,"models":Protocol::ALL.iter().map(|p| (p.as_str().into(),json!(routing::aggregate_models(&config,*p).into_iter().filter(|m|m.starts_with("qys-")).collect::<Vec<_>>()))).collect::<serde_json::Map<String,Value>>()})
            }
            StackCommand::Enable | StackCommand::Disable => {
                let enabled = matches!(command, StackCommand::Enable);
                confirm(
                    yes,
                    &format!(
                        "{} provider-scoped Stack model IDs?",
                        if enabled { "Enable" } else { "Disable" }
                    ),
                )?;
                config::update(|c| {
                    c.stack_enabled = enabled;
                    Ok(())
                })?;
                process::reload_if_running().await?;
                json!({"enabled":enabled})
            }
        },
        RouterCommand::Apply {
            client,
            model,
            dry_run,
        } => {
            if !dry_run {
                confirm(
                    yes,
                    &format!("Back up and point {} at the local Router?", client.id()),
                )?;
            }
            super::clients::apply(client, model.as_deref(), dry_run)?
        }
    };
    Ok(Some(value))
}

#[cfg(test)]
mod tests {
    use crate::cli::Cli;
    use clap::Parser;
    #[test]
    fn router_commands_parse_and_mutations_can_be_confirmed_noninteractively() {
        for args in [
            vec!["quyan", "router", "start", "--yes"],
            vec!["quyan", "router", "models", "--refresh"],
            vec!["quyan", "router", "stack", "enable", "--yes"],
            vec![
                "quyan",
                "router",
                "profile",
                "add",
                "--token-id",
                "token-id",
                "--priority",
                "2",
            ],
            vec![
                "quyan",
                "router",
                "route",
                "set",
                "--protocol",
                "openai-responses",
                "--model",
                "m",
                "--profile",
                "p",
                "--upstream-model",
                "real",
            ],
        ] {
            assert!(Cli::try_parse_from(args).is_ok());
        }
        assert!(Cli::try_parse_from([
            "quyan",
            "router",
            "route",
            "set",
            "--protocol",
            "unknown",
            "--model",
            "m",
            "--profile",
            "p"
        ])
        .is_err());
    }
}

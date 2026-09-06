use anyhow::{Context, Result};
use clap::Parser;
use serde_json::json;

use crate::{
    cli::{handlers, Cli, Command, CredentialCommand},
    core::{api::ApiClient, branding, config, credentials::{self, Credentials}},
    features::{integrations, tui, updater},
    utils::logging::{self, EventBuffer},
};

pub async fn run() -> Result<()> {
    let args = Cli::parse();
    let panel = if args.command.is_none() {
        Some(EventBuffer::new())
    } else {
        None
    };
    if let Some(sink) = &panel {
        logging::set_panel_sink(sink.clone());
    }
    let log = logging::init(
        args.debug,
        args.debug && !args.json && args.command.is_some(),
    )?;
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        platform = %logging::platform_description(),
        debug = args.debug,
        "Quyan CLI started"
    );
    if args.version {
        if !args.json {
            branding::print();
            println!("quyan {}", env!("CARGO_PKG_VERSION"));
        } else {
            println!(
                "{}",
                serde_json::to_string(&json!({"version": env!("CARGO_PKG_VERSION")}))?
            );
        }
        return Ok(());
    }
    let mut startup_errors = Vec::new();
    let mut cfg = match config::load() {
        Ok(config) => config,
        Err(error) if args.command.is_none() => {
            startup_errors.push(format!("Configuration unavailable: {error:#}"));
            config::Config::default()
        }
        Err(error) => return Err(error).context("failed to load Quyan configuration"),
    };
    tracing::debug!(config_path = %config::path().display(), "loaded CLI configuration");
    let creds = match credentials::load() {
        Ok(credentials) => credentials,
        Err(error) if args.command.is_none() => {
            startup_errors.push(format!("Credential store unavailable: {error:#}"));
            Credentials::default()
        }
        Err(error) => return Err(error).context("failed to load Quyan credentials"),
    };
    tracing::debug!(
        account_configured = creds.access_token.is_some() || creds.access_key.is_some(),
        relay_configured = creds.relay_token.is_some(),
        product_configured = creds.product_key.is_some(),
        "loaded credential availability"
    );
    if let Some(command) = args.command {
        match command {
            Command::Version => {
                if !args.json {
                    branding::print();
                }
                return handlers::print_value(json!({"version": env!("CARGO_PKG_VERSION")}), args.json);
            }
            Command::Login(login) => {
                return handlers::handle_login(login, &cfg.api_base_url, &cfg.auth_base_url, args.json).await;
            }
            Command::Credential {
                command: CredentialCommand::Import { stdin: _ },
            } => {
                return handlers::handle_credential_import(args.json);
            }
            Command::Logout => {
                return handlers::handle_logout(args.json);
            }
            Command::Status => {
                if !args.json {
                    branding::print();
                }
                return handlers::print_value(
                    json!({"apiBaseUrl":cfg.api_base_url,"relayBaseUrl":cfg.relay_base_url,"authenticated":creds.access_token.is_some() || creds.access_key.is_some(),"credentialTypes":{"accessKey":creds.access_key.is_some(),"relayToken":creds.relay_token.is_some(),"productKey":creds.product_key.is_some()}}),
                    args.json,
                );
            }
            Command::Config { command } => {
                if !args.json {
                    branding::print();
                }
                return handlers::handle_config(command, &mut cfg, &creds, args.json);
            }
            Command::Update { check } => {
                if !args.json {
                    branding::print();
                }
                return handlers::handle_update(check, args.json).await;
            }
            Command::Apply(apply_args) => {
                if !args.json {
                    branding::print();
                }
                let value = integrations::apply(&creds, apply_args.client.as_deref(), apply_args.dry_run, !apply_args.no_backup)?;
                return handlers::print_value(value, args.json);
            }
            command => {
                if !args.json {
                    branding::print();
                }
                let api = ApiClient::new(creds.clone(), &cfg.locale)?;
                return dispatch_api_command(command, api, args.json).await;
            }
        }
    }
    let events = panel.expect("interactive run must own the shared event buffer");
    events.push("INFO", "CLI started");

    if updater::should_check_for_updates() {
        events.push("INFO", "Checking for updates...");
        let events_clone = events.clone();
        tokio::spawn(async move {
            match updater::check_for_updates(false).await {
                Ok(Some(info)) => {
                    let msg = updater::format_update_notification(&info);
                    tracing::info!("{}", msg);
                    events_clone.push("INFO", msg);
                }
                Ok(None) => {
                    tracing::debug!("no updates available");
                }
                Err(error) => {
                    tracing::warn!(error = %error, "update check failed");
                }
            }
        });
    }

    if startup_errors.is_empty() {
        events.push("INFO", "Configuration and credentials loaded");
    } else {
        for error in startup_errors {
            tracing::error!("{error}");
            events.push("ERROR", error);
        }
    }
    events.push(
        "INFO",
        if creds.access_token.is_some() || creds.access_key.is_some() {
            "Account credential configured"
        } else {
            "Account credential is not configured"
        },
    );
    events.push(
        "INFO",
        if creds.relay_token.is_some() {
            "Relay credential configured"
        } else {
            "Relay credential is not configured"
        },
    );
    events.push("INFO", format!("Log file: {}", log.path().display()));
    let config_path = config::path().display().to_string();
    let log_path = log.path().display().to_string();
    let api = ApiClient::new(creds.clone(), &cfg.locale)?;
    tui::run(
        tui::StatusView {
            api_base_url: &cfg.api_base_url,
            relay_base_url: &cfg.relay_base_url,
            auth_base_url: &cfg.auth_base_url,
            locale: &cfg.locale,
            config_path: &config_path,
            account_configured: creds.access_token.is_some() || creds.access_key.is_some(),
            relay_configured: creds.relay_token.is_some(),
            product_configured: creds.product_key.is_some(),
            log_path: &log_path,
            events: &events,
        },
        api,
    )
    .await
}

async fn dispatch_api_command(
    command: Command,
    api: ApiClient,
    json_output: bool,
) -> Result<()> {
    match command {
        Command::Account => handlers::handle_account(&api, json_output).await,
        Command::Relay { command } => handlers::handle_relay_command(command, &api, json_output).await,
        Command::Product { command } => handlers::handle_product_command(command, &api, json_output).await,
        _ => anyhow::bail!("unsupported command"),
    }
}

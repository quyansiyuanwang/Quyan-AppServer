use anyhow::{Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use clap::{ArgAction, Args, Parser, Subcommand};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::TcpListener,
    time::Duration,
};
use url::Url;

use crate::{
    api::ApiClient,
    branding, config,
    credentials::{self, Credentials},
    integrations,
    services::{account, json_endpoint_product as product, relay},
    tui,
};

#[derive(Debug, Parser)]
#[command(
    name = "quyan",
    about = "Quyan native command-line client",
    disable_version_flag = true
)]
struct Cli {
    #[arg(short = 'v', long, global = true, action = ArgAction::SetTrue)]
    version: bool,
    #[arg(long, global = true)]
    json: bool,
    #[arg(long, global = true, default_value = "zh-CN", value_parser = ["zh-CN", "en-US"])]
    lang: String,
    #[arg(long, global = true)]
    no_color: bool,
    #[arg(long, global = true)]
    debug: bool,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Subcommand)]
enum Command {
    Login(LoginArgs),
    Credential {
        #[command(subcommand)]
        command: CredentialCommand,
    },
    Logout,
    Status,
    Account,
    Relay {
        #[command(subcommand)]
        command: RelayCommand,
    },
    Apply(ApplyArgs),
    Config {
        #[command(subcommand)]
        command: ConfigCommand,
    },
    Product {
        #[command(subcommand)]
        command: ProductCommand,
    },
    Version,
}

#[derive(Debug, Args)]
struct LoginArgs {
    #[arg(long, conflicts_with = "qrcode")]
    browser: bool,
    #[arg(long, conflicts_with = "browser")]
    qrcode: bool,
}

#[derive(Debug, Subcommand)]
enum CredentialCommand {
    Import {
        #[arg(long)]
        stdin: bool,
    },
}

#[derive(Debug, Subcommand)]
enum RelayCommand {
    Token {
        #[command(subcommand)]
        command: RelayTokenCommand,
    },
    Channels {
        #[command(subcommand)]
        command: ChannelsCommand,
    },
}
#[derive(Debug, Subcommand)]
enum RelayTokenCommand {
    List,
    Create,
    Update { id: String },
    Delete { id: String },
    Usage { id: String },
}
#[derive(Debug, Subcommand)]
enum ChannelsCommand {
    List,
}

#[derive(Debug, Args)]
struct ApplyArgs {
    #[arg(long)]
    client: Option<String>,
    #[arg(long)]
    dry_run: bool,
    #[arg(long)]
    no_backup: bool,
}

#[derive(Debug, Subcommand)]
enum ConfigCommand {
    Get,
    Set { key: String, value: String },
    Reset,
}
#[derive(Debug, Subcommand)]
enum ProductCommand {
    JsonEndpoints {
        #[command(subcommand)]
        command: ProductJsonCommand,
    },
}
#[derive(Debug, Subcommand)]
enum ProductJsonCommand {
    Get,
    Update {
        #[arg(long)]
        file: String,
    },
    Clear,
    Usage,
}

pub async fn run() -> Result<()> {
    let args = Cli::parse();
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
    let mut cfg = config::load()?;
    let mut creds = credentials::load()?;
    if let Some(command) = args.command {
        match command {
            Command::Version => {
                if !args.json {
                    branding::print();
                }
                return print_value(json!({"version": env!("CARGO_PKG_VERSION")}), args.json);
            }
            Command::Login(login) => {
                if !args.json {
                    branding::print();
                }
                creds = if login.browser {
                    browser_login(&cfg.api_base_url).await?
                } else if login.qrcode {
                    qr_login(&cfg.api_base_url, &cfg.locale).await?
                } else {
                    anyhow::bail!("choose --browser or --qrcode")
                };
                credentials::save(&creds)?;
                return print_value(json!({"loggedIn":true}), args.json);
            }
            Command::Credential {
                command: CredentialCommand::Import { stdin: _ },
            } => {
                if !args.json {
                    branding::print();
                }
                let mut value = String::new();
                std::io::stdin().read_to_string(&mut value)?;
                let value = value.trim();
                match credentials::classify(value) {
                    "access-key" => creds.access_key = Some(value.into()),
                    "relay-token" => creds.relay_token = Some(value.into()),
                    "product-key" => creds.product_key = Some(value.into()),
                    _ => anyhow::bail!("unsupported credential prefix"),
                }
                credentials::save(&creds)?;
                return print_value(
                    json!({"imported":true,"type":credentials::classify(value)}),
                    args.json,
                );
            }
            Command::Logout => {
                if !args.json {
                    branding::print();
                }
                config::reset()?;
                return print_value(json!({"loggedOut":true}), args.json);
            }
            Command::Status => {
                if !args.json {
                    branding::print();
                }
                return print_value(
                    json!({"apiBaseUrl":cfg.api_base_url,"relayBaseUrl":cfg.relay_base_url,"authenticated":creds.access_token.is_some() || creds.access_key.is_some(),"credentialTypes":{"accessKey":creds.access_key.is_some(),"relayToken":creds.relay_token.is_some(),"productKey":creds.product_key.is_some()}}),
                    args.json,
                );
            }
            Command::Config { command } => {
                if !args.json {
                    branding::print();
                }
                return handle_config(command, &mut cfg, &creds, args.json);
            }
            command => {
                if !args.json {
                    branding::print();
                }
                let api = ApiClient::new(creds.clone(), &cfg.locale)?;
                return dispatch(command, api, &creds, args.json).await;
            }
        }
    }
    let api = ApiClient::new(creds, &cfg.locale)?;
    let value = relay::tokens(&api)
        .await
        .unwrap_or_else(|error| json!({"error":error.to_string()}));
    let items = value
        .get("records")
        .or_else(|| value.get("items"))
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .map(|v| {
                    v.get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("Relay token")
                        .to_string()
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    tui::run(&items)
}

async fn dispatch(
    command: Command,
    api: ApiClient,
    creds: &Credentials,
    json_output: bool,
) -> Result<()> {
    let value = match command {
        Command::Account => {
            json!({"profile":account::profile(&api).await?,"balance":account::balance(&api).await?,"usage":account::usage(&api).await?})
        }
        Command::Relay {
            command: RelayCommand::Token { command },
        } => match command {
            RelayTokenCommand::List => relay::tokens(&api).await?,
            RelayTokenCommand::Create => relay::create_token(&api).await?,
            RelayTokenCommand::Update { id } => {
                relay::update_token(&api, &id, read_json_stdin()?).await?
            }
            RelayTokenCommand::Delete { id } => relay::delete_token(&api, &id).await?,
            RelayTokenCommand::Usage { id } => relay::token_usage(&api, &id).await?,
        },
        Command::Relay {
            command:
                RelayCommand::Channels {
                    command: ChannelsCommand::List,
                },
        } => relay::channels(&api).await?,
        Command::Apply(args) => {
            integrations::apply(creds, args.client.as_deref(), args.dry_run, !args.no_backup)?
        }
        Command::Product {
            command: ProductCommand::JsonEndpoints { command },
        } => match command {
            ProductJsonCommand::Get => product::get(&api).await?,
            ProductJsonCommand::Update { file } => {
                product::update(&api, serde_json::from_slice(&std::fs::read(file)?)?).await?
            }
            ProductJsonCommand::Clear => product::clear(&api).await?,
            ProductJsonCommand::Usage => product::usage(&api).await?,
        },
        _ => anyhow::bail!("unsupported command"),
    };
    print_value(value, json_output)
}

fn handle_config(
    command: ConfigCommand,
    cfg: &mut config::Config,
    creds: &Credentials,
    json_output: bool,
) -> Result<()> {
    match command {
        ConfigCommand::Get => print_value(config::masked(cfg, creds), json_output),
        ConfigCommand::Set { key, value } => {
            cfg.metadata
                .insert(key.clone(), Value::String(value.clone()));
            config::save(cfg)?;
            print_value(json!({"key":key,"value":value}), json_output)
        }
        ConfigCommand::Reset => {
            config::reset()?;
            print_value(json!({"reset":true}), json_output)
        }
    }
}

fn read_json_stdin() -> Result<Value> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    Ok(serde_json::from_str(&input)?)
}
fn print_value(value: Value, json_output: bool) -> Result<()> {
    if json_output {
        println!("{}", serde_json::to_string(&value)?);
    } else if let Some(version) = value.get("version").and_then(Value::as_str) {
        println!("quyan {version}");
    } else {
        println!("{}", serde_json::to_string_pretty(&value)?);
    }
    Ok(())
}

async fn browser_login(base: &str) -> Result<Credentials> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    let state = uuid::Uuid::new_v4().to_string();
    let verifier = format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let redirect = format!("http://127.0.0.1:{port}/callback");
    let mut url = Url::parse(&format!("{base}/v1/oauth/authorize"))?;
    url.query_pairs_mut().append_pair("response_type","code").append_pair("client_id", "quyan-cli").append_pair("redirect_uri", &redirect).append_pair("scope", "profile relay:token:read relay:token:create relay:token:update relay:token:delete relay:channel:read relay:usage:read balance:read").append_pair("state", &state).append_pair("code_challenge", &challenge).append_pair("code_challenge_method", "S256");
    open::that(url.as_str())?;
    let (mut stream, _) = listener.accept()?;
    let mut request = [0u8; 4096];
    let size = stream.read(&mut request)?;
    let first = String::from_utf8_lossy(&request[..size]);
    let target = first
        .split_whitespace()
        .nth(1)
        .context("invalid OAuth callback")?;
    let callback = Url::parse(&format!("http://localhost{target}"))?;
    if callback
        .query_pairs()
        .find(|(k, _)| k == "state")
        .map(|(_, v)| v != state)
        .unwrap_or(true)
    {
        anyhow::bail!("OAuth state validation failed");
    }
    let code = callback
        .query_pairs()
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v.into_owned())
        .context("OAuth authorization code missing")?;
    stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nQuyan login complete. You can close this window.")?;
    let response = reqwest::Client::new()
        .post(format!("{base}/v1/oauth/token"))
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", "quyan-cli"),
            ("code", &code),
            ("redirect_uri", &redirect),
            ("code_verifier", &verifier),
        ])
        .send()
        .await?;
    let body: Value = response.json().await?;
    Ok(Credentials {
        access_token: body
            .get("access_token")
            .and_then(Value::as_str)
            .map(String::from),
        refresh_token: body
            .get("refresh_token")
            .and_then(Value::as_str)
            .map(String::from),
        ..Default::default()
    })
}

async fn qr_login(base: &str, locale: &str) -> Result<Credentials> {
    let client = reqwest::Client::new();
    let session: Value = client
        .post(format!("{base}/v1/auth/qr-login/session"))
        .header("X-Locale", locale)
        .send()
        .await?
        .json()
        .await?;
    let id = session
        .get("data")
        .and_then(|v| v.get("sessionId"))
        .or_else(|| session.get("sessionId"))
        .and_then(Value::as_str)
        .context("QR session id missing")?;
    if let Some(code) = session
        .get("data")
        .and_then(|v| v.get("qrCodeDataUrl"))
        .or_else(|| session.get("qrCodeDataUrl"))
        .and_then(Value::as_str)
    {
        println!("Scan this QR code URL in the Quyan app:\n{code}");
    }
    let deadline = tokio::time::Instant::now() + Duration::from_secs(180);
    loop {
        if tokio::time::Instant::now() > deadline {
            anyhow::bail!("QR login timed out");
        }
        let status: Value = client
            .get(format!("{base}/v1/auth/qr-login/status?sessionId={id}"))
            .send()
            .await?
            .json()
            .await?;
        let data = status.get("data").unwrap_or(&status);
        if data.get("status").and_then(Value::as_str) == Some("approved") {
            let auth = data.get("auth").context("QR auth missing")?;
            return Ok(Credentials {
                access_token: auth
                    .get("access_token")
                    .and_then(Value::as_str)
                    .map(String::from),
                refresh_token: auth
                    .get("refresh_token")
                    .and_then(Value::as_str)
                    .map(String::from),
                ..Default::default()
            });
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

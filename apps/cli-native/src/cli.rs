use anyhow::{bail, ensure, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use clap::{ArgAction, Args, Parser, Subcommand};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, io::Read, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use url::Url;
use uuid::Uuid;

const CLI_CLIENT_ID: &str = "quyan-cli";
const OAUTH_CALLBACK_HOST: &str = "127.0.0.1";
const OAUTH_CALLBACK_PORT: u16 = 40016;
const OAUTH_TIMEOUT_SECS: u64 = 300;
const OAUTH_SCOPES: &str = "profile relay:token:read relay:token:create relay:token:update relay:token:delete relay:channel:read relay:usage:read balance:read";
const CODE_CHALLENGE_METHOD: &str = "S256";

use crate::{
    api::ApiClient,
    branding, config,
    credentials::{self, Credentials},
    integrations,
    logging::{self, EventBuffer},
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
    // Interactive runs (no subcommand) render an alternate screen on stdout;
    // diagnostics must not be mirrored to stderr or they would corrupt the
    // TUI. Instead they are routed to the shared "Recent events" buffer that
    // the TUI renders on the home screen. One-shot subcommands may mirror to
    // stderr for debugging.
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
    let mut creds = match credentials::load() {
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
                return print_value(json!({"version": env!("CARGO_PKG_VERSION")}), args.json);
            }
            Command::Login(login) => {
                if !args.json {
                    branding::print();
                }
                creds = if login.browser {
                    browser_login(&cfg.api_base_url, &cfg.auth_base_url).await?
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
    // Reaching here means no subcommand was given, so the shared panel buffer
    // was created above; use it as the "Recent events" source.
    let events = panel.expect("interactive run must own the shared event buffer");
    events.push("INFO", "CLI started");
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

pub(crate) async fn browser_login(api_base: &str, auth_base: &str) -> Result<Credentials> {
    let session = begin_browser_login(api_base, auth_base).await?;
    complete_browser_login(session).await
}

/// An in-progress browser login whose callback wait can be cancelled by
/// dropping the session (which closes the bound listener).
pub(crate) struct BrowserLoginSession {
    listener: TcpListener,
    state: String,
    verifier: String,
    redirect_uri: String,
    api_base: String,
}

/// Binds the callback listener, builds and validates the authorization URL,
/// and opens the browser. Returns a session for the caller to complete or
/// cancel. No secrets are written to the log.
pub(crate) async fn begin_browser_login(
    api_base: &str,
    auth_base: &str,
) -> Result<BrowserLoginSession> {
    let listener = TcpListener::bind((OAUTH_CALLBACK_HOST, OAUTH_CALLBACK_PORT))
        .await
        .with_context(|| {
            format!(
                "failed to bind OAuth callback on {OAUTH_CALLBACK_HOST}:{OAUTH_CALLBACK_PORT}; close another QuYan login session and retry"
            )
        })?;
    tracing::debug!("OAuth callback listener started");
    let state = Uuid::new_v4().to_string();
    let verifier = format!("{}{}", Uuid::new_v4(), Uuid::new_v4());
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let redirect_uri = oauth_redirect_uri();
    let url = build_browser_authorization_url(auth_base, &redirect_uri, &state, &challenge)?;
    tracing::debug!(
        host = %url.host_str().unwrap_or_default(),
        path = %url.path(),
        has_redirect_uri = query_has(&url, "redirect_uri"),
        has_state = query_has(&url, "state"),
        uses_pkce_s256 = query_value(&url, "code_challenge_method").as_deref() == Some(CODE_CHALLENGE_METHOD),
        "OAuth authorization URL validated"
    );
    tracing::debug!("opening browser authorization page");
    open::that(url.as_str())?;
    Ok(BrowserLoginSession {
        listener,
        state,
        verifier,
        redirect_uri,
        api_base: api_base.trim_end_matches('/').to_string(),
    })
}

/// Waits for the callback, exchanges the authorization code, and returns the
/// credentials. Consumes the session so the callback listener is released.
pub(crate) async fn complete_browser_login(session: BrowserLoginSession) -> Result<Credentials> {
    let BrowserLoginSession {
        listener,
        state,
        verifier,
        redirect_uri,
        api_base,
    } = session;
    let code = match tokio::time::timeout(
        Duration::from_secs(OAUTH_TIMEOUT_SECS),
        wait_for_oauth_callback(listener, &state),
    )
    .await
    {
        Ok(Ok(code)) => code,
        Ok(Err(error)) => return Err(error),
        Err(_) => bail!("OAuth login timed out after {OAUTH_TIMEOUT_SECS}s; retry and complete the browser authorization within the window"),
    };
    tracing::debug!("received OAuth callback after state validation");
    let response = reqwest::Client::new()
        .post(format!("{api_base}/v1/oauth/token"))
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", CLI_CLIENT_ID),
            ("code", &code),
            ("redirect_uri", redirect_uri.as_str()),
            ("code_verifier", &verifier),
        ])
        .send()
        .await?;
    tracing::debug!(status = %response.status(), "received OAuth token response");
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

pub(crate) fn oauth_redirect_uri() -> String {
    format!("http://{OAUTH_CALLBACK_HOST}:{OAUTH_CALLBACK_PORT}/callback")
}

/// Waits for the single OAuth callback on the bound listener and returns the
/// validated authorization code. The callback and the exchange request always
/// share the same redirect URI so the authorization server can match them.
async fn wait_for_oauth_callback(listener: TcpListener, expected_state: &str) -> Result<String> {
    let (mut stream, _) = listener.accept().await?;
    let mut request = [0u8; 4096];
    let size = stream.read(&mut request).await?;
    let first = String::from_utf8_lossy(&request[..size]);
    let target = first
        .split_whitespace()
        .nth(1)
        .context("invalid OAuth callback")?;
    let code = extract_oauth_code(
        &format!("http://{OAUTH_CALLBACK_HOST}{target}"),
        expected_state,
    )?;
    stream
        .write_all(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nQuyan login complete. You can close this window.",
        )
        .await?;
    Ok(code)
}

/// Parses a callback URL and returns the validated authorization code. Rejects
/// provider errors, state mismatches, and missing codes before any code is
/// exchanged. Takes a full URL (host is ignored) so it is testable.
pub(crate) fn extract_oauth_code(callback_url: &str, expected_state: &str) -> Result<String> {
    let url = Url::parse(callback_url).context("invalid OAuth callback URL")?;
    let pairs: HashMap<String, String> = url.query_pairs().into_owned().collect();
    if let Some(error) = pairs.get("error") {
        bail!("OAuth provider returned an error: {error}");
    }
    let state = pairs
        .get("state")
        .context("OAuth callback is missing the state parameter")?;
    ensure!(
        state == expected_state,
        "OAuth state validation failed (state mismatch)"
    );
    pairs
        .get("code")
        .cloned()
        .context("OAuth authorization code missing")
}

fn query_value(url: &Url, key: &str) -> Option<String> {
    url.query_pairs()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.into_owned())
}

fn query_has(url: &Url, key: &str) -> bool {
    url.query_pairs().any(|(k, _)| k == key)
}

/// Builds the browser-facing authorization URL. The UI is hosted by the
/// identity SPA; the API host is deliberately not accepted here.
pub(crate) fn build_browser_authorization_url(
    auth_base: &str,
    redirect_uri: &str,
    state: &str,
    code_challenge: &str,
) -> Result<Url> {
    let mut url = Url::parse(&format!(
        "{}/oauth/authorize",
        auth_base.trim_end_matches('/')
    ))?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", CLI_CLIENT_ID)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("scope", OAUTH_SCOPES)
        .append_pair("state", state)
        .append_pair("code_challenge", code_challenge)
        .append_pair("code_challenge_method", CODE_CHALLENGE_METHOD);
    validate_authorization_url(&url, redirect_uri, state, code_challenge)?;
    Ok(url)
}

/// Verifies every parameter the authorization server requires before the URL
/// is handed to the browser. Catches malformed client-side URL construction
/// before it reaches the identity site.
fn validate_authorization_url(
    url: &Url,
    expected_redirect_uri: &str,
    expected_state: &str,
    expected_challenge: &str,
) -> Result<()> {
    let query: HashMap<String, String> = url.query_pairs().into_owned().collect();
    ensure!(
        query.get("response_type").map(String::as_str) == Some("code"),
        "OAuth URL is missing response_type=code"
    );
    ensure!(
        query.get("client_id").map(String::as_str) == Some(CLI_CLIENT_ID),
        "OAuth URL has an invalid client_id"
    );
    ensure!(
        query.get("redirect_uri").map(String::as_str) == Some(expected_redirect_uri),
        "OAuth URL is missing the registered redirect_uri"
    );
    ensure!(
        query.get("state").map(String::as_str) == Some(expected_state),
        "OAuth URL has an invalid state"
    );
    ensure!(
        query.get("code_challenge").map(String::as_str) == Some(expected_challenge),
        "OAuth URL has an invalid code_challenge"
    );
    ensure!(
        query.get("code_challenge_method").map(String::as_str) == Some(CODE_CHALLENGE_METHOD),
        "OAuth URL must use PKCE S256"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        build_browser_authorization_url, extract_oauth_code, oauth_redirect_uri,
        validate_authorization_url, CODE_CHALLENGE_METHOD,
    };
    use std::collections::HashMap;

    #[test]
    fn authorization_url_contains_registered_redirect_uri() {
        let url = build_browser_authorization_url(
            "https://auth.qysyw.cn",
            "http://127.0.0.1:40016/callback",
            "state-value",
            "challenge-value",
        )
        .expect("valid authorization URL");

        let query: HashMap<String, String> = url.query_pairs().into_owned().collect();
        assert_eq!(
            query.get("redirect_uri").map(String::as_str),
            Some("http://127.0.0.1:40016/callback")
        );
        assert_eq!(query.get("response_type").map(String::as_str), Some("code"));
        assert_eq!(
            query.get("client_id").map(String::as_str),
            Some("quyan-cli")
        );
        assert_eq!(
            query.get("code_challenge_method").map(String::as_str),
            Some(CODE_CHALLENGE_METHOD)
        );
        assert_eq!(query.get("state").map(String::as_str), Some("state-value"));
        assert!(query.contains_key("code_challenge"));
        assert_eq!(
            query.get("scope").map(String::as_str),
            Some(
                "profile relay:token:read relay:token:create relay:token:update relay:token:delete relay:channel:read relay:usage:read balance:read"
            )
        );
    }

    #[test]
    fn authorization_url_uses_the_identity_site_route() {
        let url = build_browser_authorization_url(
            "https://auth.qysyw.cn/",
            "http://127.0.0.1:40016/callback",
            "state-1",
            "challenge-1",
        )
        .expect("valid authorization URL");

        assert_eq!(url.host_str(), Some("auth.qysyw.cn"));
        assert_eq!(url.path(), "/oauth/authorize");
    }

    #[test]
    fn validate_authorization_url_accepts_a_complete_url() {
        let url = build_browser_authorization_url(
            "https://auth.qysyw.cn",
            "http://127.0.0.1:40016/callback",
            "state-1",
            "challenge-1",
        )
        .expect("valid URL");
        validate_authorization_url(
            &url,
            "http://127.0.0.1:40016/callback",
            "state-1",
            "challenge-1",
        )
        .expect("complete URL validates");
    }

    #[test]
    fn validate_authorization_url_rejects_a_missing_redirect_uri() {
        let url = build_browser_authorization_url(
            "https://auth.qysyw.cn",
            "http://127.0.0.1:40016/callback",
            "state-1",
            "challenge-1",
        )
        .expect("valid URL");
        let error = validate_authorization_url(
            &url,
            "http://127.0.0.1:9999/other",
            "state-1",
            "challenge-1",
        )
        .expect_err("mismatched redirect_uri must fail");
        assert!(
            format!("{error:#}").contains("redirect_uri"),
            "unexpected error: {error:#}"
        );
    }

    #[test]
    fn oauth_redirect_uri_is_the_registered_callback() {
        assert_eq!(oauth_redirect_uri(), "http://127.0.0.1:40016/callback");
    }

    #[test]
    fn extract_code_accepts_state_and_code() {
        let code = extract_oauth_code(
            "http://127.0.0.1:40016/callback?state=abc&code=secret-code",
            "abc",
        )
        .expect("valid callback");
        assert_eq!(code, "secret-code");
    }

    #[test]
    fn extract_code_rejects_a_state_mismatch() {
        let error = extract_oauth_code(
            "http://127.0.0.1:40016/callback?state=wrong&code=code-1",
            "expected",
        )
        .expect_err("state mismatch must fail");
        assert!(format!("{error:#}").contains("state"));
    }

    #[test]
    fn extract_code_rejects_a_missing_code() {
        let error = extract_oauth_code("http://127.0.0.1:40016/callback?state=abc", "abc")
            .expect_err("missing code must fail");
        assert!(format!("{error:#}").contains("code"));
    }

    #[test]
    fn extract_code_surfaces_provider_errors() {
        let error = extract_oauth_code(
            "http://127.0.0.1:40016/callback?error=access_denied&state=abc",
            "abc",
        )
        .expect_err("provider error must fail");
        assert!(format!("{error:#}").contains("access_denied"));
    }

    #[test]
    fn extract_code_decodes_url_encoded_parameters() {
        let code = extract_oauth_code(
            "http://127.0.0.1:40016/callback?state=abc%20state&code=a%2Bb%3D1",
            "abc state",
        )
        .expect("encoded callback parses");
        assert_eq!(code, "a+b=1");
    }
}

async fn qr_login(base: &str, locale: &str) -> Result<Credentials> {
    let client = reqwest::Client::new();
    tracing::debug!("creating QR login session");
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
        tracing::debug!(
            status = data
                .get("status")
                .and_then(|value| value.as_str())
                .unwrap_or("pending"),
            "polled QR login session"
        );
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

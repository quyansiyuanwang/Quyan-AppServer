use anyhow::{bail, ensure, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, io::Read, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use url::Url;
use uuid::Uuid;

use crate::core::{branding, credentials::{self, Credentials}};

const CLI_CLIENT_ID: &str = "quyan-cli";
const OAUTH_CALLBACK_HOST: &str = "127.0.0.1";
const OAUTH_CALLBACK_PORT: u16 = 40016;
const OAUTH_TIMEOUT_SECS: u64 = 300;
const OAUTH_SCOPES: &str = "profile relay:token:read relay:token:create relay:token:update relay:token:delete relay:channel:read relay:usage:read balance:read";
const CODE_CHALLENGE_METHOD: &str = "S256";

pub async fn handle_login(
    login_args: super::super::LoginArgs,
    api_base: &str,
    auth_base: &str,
    json_output: bool,
) -> Result<()> {
    if !json_output {
        branding::print();
    }
    let creds = if login_args.browser {
        browser_login(api_base, auth_base).await?
    } else if login_args.qrcode {
        qr_login(api_base, &"zh-CN").await?
    } else {
        anyhow::bail!("choose --browser or --qrcode")
    };
    credentials::save(&creds)?;
    super::common::print_value(json!({"loggedIn":true}), json_output)
}

pub fn handle_logout(json_output: bool) -> Result<()> {
    if !json_output {
        branding::print();
    }
    crate::core::config::reset()?;
    super::common::print_value(json!({"loggedOut":true}), json_output)
}

pub fn handle_credential_import(json_output: bool) -> Result<()> {
    if !json_output {
        branding::print();
    }
    let mut value = String::new();
    std::io::stdin().read_to_string(&mut value)?;
    let value = value.trim();

    let mut creds = credentials::load().unwrap_or_default();
    match credentials::classify(value) {
        "access-key" => creds.access_key = Some(value.into()),
        "relay-token" => creds.relay_token = Some(value.into()),
        "product-key" => creds.product_key = Some(value.into()),
        _ => anyhow::bail!("unsupported credential prefix"),
    }
    credentials::save(&creds)?;
    super::common::print_value(
        json!({"imported":true,"type":credentials::classify(value)}),
        json_output,
    )
}

pub(crate) async fn browser_login(api_base: &str, auth_base: &str) -> Result<Credentials> {
    let session = begin_browser_login(api_base, auth_base).await?;
    complete_browser_login(session).await
}

pub(crate) struct BrowserLoginSession {
    pub listener: TcpListener,
    pub state: String,
    pub verifier: String,
    pub redirect_uri: String,
    pub api_base: String,
}

pub(crate) async fn begin_browser_login(
    api_base: &str,
    auth_base: &str,
) -> Result<BrowserLoginSession> {
    let listener = TcpListener::bind((OAUTH_CALLBACK_HOST, OAUTH_CALLBACK_PORT))
        .await
        .with_context(|| {
            format!(
                "failed to bind OAuth callback on {OAUTH_CALLBACK_HOST}:{OAUTH_CALLBACK_PORT}"
            )
        })?;
    tracing::debug!("OAuth callback listener started");
    let state = Uuid::new_v4().to_string();
    let verifier = format!("{}{}", Uuid::new_v4(), Uuid::new_v4());
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let redirect_uri = oauth_redirect_uri();
    let url = build_browser_authorization_url(auth_base, &redirect_uri, &state, &challenge)?;
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
        Err(_) => bail!("OAuth login timed out after {OAUTH_TIMEOUT_SECS}s"),
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

fn build_browser_authorization_url(
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
    Ok(url)
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

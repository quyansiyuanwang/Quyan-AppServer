use anyhow::{bail, ensure, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, io::Read, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};
use url::Url;
use uuid::Uuid;

use crate::core::{
    branding,
    credentials::{self, Credentials},
};

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
    if !login_args.browser {
        credentials::save(&creds)?;
    }
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
    pub result_url: Url,
}

pub(crate) async fn begin_browser_login(
    api_base: &str,
    auth_base: &str,
) -> Result<BrowserLoginSession> {
    let result_url = browser_result_url(auth_base)?;
    let listener = TcpListener::bind((OAUTH_CALLBACK_HOST, OAUTH_CALLBACK_PORT))
        .await
        .with_context(|| {
            format!("failed to bind OAuth callback on {OAUTH_CALLBACK_HOST}:{OAUTH_CALLBACK_PORT}")
        })?;
    tracing::debug!("OAuth callback listener bound on {OAUTH_CALLBACK_HOST}:{OAUTH_CALLBACK_PORT}");
    let state = Uuid::new_v4().to_string();
    let verifier = format!("{}{}", Uuid::new_v4(), Uuid::new_v4());
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let redirect_uri = oauth_redirect_uri();
    let url = build_browser_authorization_url(auth_base, &redirect_uri, &state, &challenge)?;
    tracing::debug!("Opening browser for OAuth authorization");

    // Some Windows launchers keep the parent process attached to the browser
    // process. A detached launch keeps the TUI responsive while the callback
    // listener waits for the authorization result.
    open::that_detached(url.as_str())?;
    tracing::debug!("Browser opened, listener ready for callback");
    Ok(BrowserLoginSession {
        listener,
        state,
        verifier,
        redirect_uri,
        api_base: api_base.trim_end_matches('/').to_string(),
        result_url,
    })
}

pub(crate) async fn complete_browser_login(session: BrowserLoginSession) -> Result<Credentials> {
    complete_browser_login_with_store(session, |mut account| {
        // Preserve separately imported Access/Relay/Product keys when signing in again.
        let mut stored = credentials::load()?;
        stored.access_token = account.access_token.take();
        stored.refresh_token = account.refresh_token.take();
        stored.replay_session_id = None;
        stored.replay_signing_key = None;
        credentials::save(&stored)?;
        Ok(stored)
    })
    .await
}

async fn complete_browser_login_with_store(
    session: BrowserLoginSession,
    save: impl FnOnce(Credentials) -> Result<Credentials>,
) -> Result<Credentials> {
    let (mut stream, code) = tokio::time::timeout(
        Duration::from_secs(OAUTH_TIMEOUT_SECS),
        wait_for_oauth_callback(&session.listener, &session.state),
    )
    .await
    .context("OAuth login timed out")??;
    let result = match code {
        Ok(code) => exchange_browser_code(&session, &code).await.and_then(save),
        Err(error) => Err(error),
    };
    // Only claim success after both token exchange and durable credential storage.
    // Never forward code/state/token/error text to the hosted result page.
    let mut result_url = session.result_url.clone();
    result_url
        .query_pairs_mut()
        .append_pair("status", if result.is_ok() { "success" } else { "failed" });
    if send_callback_response(&mut stream, "303 See Other", Some(result_url.as_str()))
        .await
        .is_err()
    {
        // A closed browser tab must not turn a successfully saved login into a failure.
        tracing::warn!("Could not deliver OAuth browser result");
    }
    result
}

async fn exchange_browser_code(session: &BrowserLoginSession, code: &str) -> Result<Credentials> {
    let BrowserLoginSession {
        api_base,
        redirect_uri,
        verifier,
        ..
    } = session;
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()?
        .post(format!("{api_base}/v1/oauth/token"))
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", CLI_CLIENT_ID),
            ("code", code),
            ("redirect_uri", redirect_uri.as_str()),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await?;
    let status = response.status();
    let body: Value = response.json().await?;
    if !status.is_success() {
        bail!("OAuth token exchange failed (HTTP {status})");
    }
    let access_token = body
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|token| !token.trim().is_empty())
        .context("OAuth token response did not contain access_token")?;
    Ok(Credentials {
        access_token: Some(access_token.to_string()),
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

// Callback limits belong to the loopback HTTP transport, not global configuration.
const CALLBACK_HEADER_LIMIT: usize = 8192;
const CALLBACK_READ_TIMEOUT: Duration = Duration::from_secs(5);

async fn send_callback_response(
    stream: &mut TcpStream,
    status: &str,
    location: Option<&str>,
) -> Result<()> {
    let location = location
        .map(|url| format!("Location: {url}\r\n"))
        .unwrap_or_default();
    let response = format!("HTTP/1.1 {status}\r\n{location}Content-Length: 0\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n");
    tokio::time::timeout(CALLBACK_READ_TIMEOUT, stream.write_all(response.as_bytes())).await??;
    stream.shutdown().await?;
    Ok(())
}

async fn read_callback_target(stream: &mut TcpStream) -> Result<String> {
    let mut request = Vec::new();
    let mut buffer = [0u8; 1024];
    loop {
        let size = stream.read(&mut buffer).await?;
        ensure!(size > 0, "incomplete callback request");
        request.extend_from_slice(&buffer[..size]);
        ensure!(
            request.len() <= CALLBACK_HEADER_LIMIT,
            "callback headers too large"
        );
        if request.windows(4).any(|part| part == b"\r\n\r\n") {
            break;
        }
    }
    let request = std::str::from_utf8(&request)?;
    let mut line = request
        .lines()
        .next()
        .context("missing request line")?
        .split_whitespace();
    ensure!(line.next() == Some("GET"), "callback requires GET");
    let target = line.next().context("missing callback target")?;
    ensure!(target.starts_with("/callback?"), "invalid callback path");
    Ok(target.to_owned())
}

async fn wait_for_oauth_callback(
    listener: &TcpListener,
    expected_state: &str,
) -> Result<(TcpStream, Result<String>)> {
    loop {
        let (mut stream, _) = listener.accept().await?;
        let target =
            match tokio::time::timeout(CALLBACK_READ_TIMEOUT, read_callback_target(&mut stream))
                .await
            {
                Ok(Ok(target)) => target,
                _ => {
                    let _ = send_callback_response(&mut stream, "400 Bad Request", None).await;
                    continue;
                }
            };
        let url = Url::parse(&format!("http://{OAUTH_CALLBACK_HOST}{target}"))?;
        // Ignore stray requests and invalid states without consuming the login attempt.
        let states: Vec<_> = url
            .query_pairs()
            .filter(|(key, _)| key == "state")
            .collect();
        if states.len() != 1 || states[0].1 != expected_state {
            let _ = send_callback_response(&mut stream, "400 Bad Request", None).await;
            continue;
        }
        return Ok((stream, extract_oauth_code(url.as_str(), expected_state)));
    }
}

pub(crate) fn extract_oauth_code(callback_url: &str, expected_state: &str) -> Result<String> {
    let url = Url::parse(callback_url)?;
    ensure!(url.path() == "/callback", "invalid callback path");
    let mut pairs = HashMap::new();
    for (key, value) in url.query_pairs() {
        ensure!(
            pairs.insert(key.to_string(), value.to_string()).is_none(),
            "duplicate callback parameter"
        );
    }
    ensure!(
        pairs.get("state").map(String::as_str) == Some(expected_state),
        "state mismatch"
    );
    ensure!(
        !pairs.contains_key("error"),
        "OAuth authorization was denied or failed"
    );
    pairs
        .remove("code")
        .filter(|code| !code.trim().is_empty())
        .context("missing code")
}

fn browser_result_url(auth_base: &str) -> Result<Url> {
    let mut url = Url::parse(auth_base)?;
    url.set_path("/oauth/result");
    url.set_query(None);
    url.set_fragment(None);
    crate::core::endpoints::validate_endpoint(url.as_str())
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
        .and_then(Value::as_str)
        .context("missing sessionId")?;
    if let Some(code) = session
        .get("data")
        .and_then(|v| v.get("qrCodeDataUrl"))
        .and_then(Value::as_str)
    {
        println!("Scan QR:\n{code}");
    }
    let deadline = tokio::time::Instant::now() + Duration::from_secs(180);
    loop {
        if tokio::time::Instant::now() > deadline {
            bail!("QR login timed out");
        }
        let status: Value = client
            .get(format!("{base}/v1/auth/qr-login/status?sessionId={id}"))
            .send()
            .await?
            .json()
            .await?;
        if let Some(data) = status.get("data") {
            if data.get("status").and_then(Value::as_str) == Some("approved") {
                let auth = data.get("auth").context("missing auth")?;
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
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

    #[test]
    fn callback_validates_state_path_and_duplicates() {
        assert_eq!(
            extract_oauth_code(
                "http://127.0.0.1/callback?state=expected&code=test-code",
                "expected"
            )
            .unwrap(),
            "test-code"
        );
        for query in [
            "state=wrong&code=test",
            "state=expected&code=",
            "state=expected&state=expected&code=test",
            "state=expected&code=test&code=other",
            "state=expected&error=denied",
            "code=test",
        ] {
            assert!(
                extract_oauth_code(&format!("http://127.0.0.1/callback?{query}"), "expected")
                    .is_err()
            );
        }
        assert!(extract_oauth_code(
            "http://127.0.0.1/other?state=expected&code=test",
            "expected"
        )
        .is_err());
    }

    #[test]
    fn result_origin_is_derived_and_never_copies_query_or_fragment() {
        assert_eq!(
            browser_result_url("https://identity.example.test/prefix?secret=no#fragment")
                .unwrap()
                .as_str(),
            "https://identity.example.test/oauth/result"
        );
        assert!(browser_result_url("http://identity.example.test").is_err());
        assert!(browser_result_url("https://user:pass@identity.example.test").is_err());
        assert!(browser_result_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn authorization_url_uses_pkce_and_the_registered_callback() {
        let url = build_browser_authorization_url(
            "https://identity.example.test",
            &oauth_redirect_uri(),
            "test-state",
            "test-challenge",
        )
        .unwrap();
        let query: HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(url.path(), "/oauth/authorize");
        assert_eq!(query["redirect_uri"], oauth_redirect_uri());
        assert_eq!(query["code_challenge_method"], CODE_CHALLENGE_METHOD);
        assert_eq!(query["client_id"], CLI_CLIENT_ID);
    }

    async fn exchange_result(fail_store: bool, fail_exchange: bool) {
        let api = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let callback = format!("http://{}/callback", listener.local_addr().unwrap());
        let session = BrowserLoginSession {
            listener,
            state: "test-state".into(),
            verifier: "test-verifier".into(),
            redirect_uri: callback.clone(),
            api_base: format!("http://{}", api.local_addr().unwrap()),
            result_url: browser_result_url("https://identity.example.test").unwrap(),
        };
        let exchange = tokio::spawn(async move {
            let (mut socket, _) = api.accept().await.unwrap();
            let mut buffer = [0u8; 8192];
            let size = socket.read(&mut buffer).await.unwrap();
            let request = String::from_utf8_lossy(&buffer[..size]);
            assert!(request.starts_with("POST /v1/oauth/token "));
            let status = if fail_exchange {
                "400 Bad Request"
            } else {
                "200 OK"
            };
            let body = if fail_exchange {
                r#"{"error":"test_exchange_rejected"}"#
            } else {
                r#"{"access_token":"test-access","refresh_token":"test-refresh"}"#
            };
            socket.write_all(format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
        });
        let saved = Arc::new(AtomicBool::new(false));
        let saved_in_task = saved.clone();
        let login = tokio::spawn(async move {
            complete_browser_login_with_store(session, |creds| {
                ensure!(!fail_store, "test keychain unavailable");
                saved_in_task.store(true, Ordering::SeqCst);
                Ok(creds)
            })
            .await
        });
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        // Invalid-state/stray requests do not consume the listener.
        assert_eq!(
            client
                .get(format!("{callback}?state=wrong&code=untrusted"))
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
        let response = client
            .get(format!("{callback}?state=test-state&code=test-code"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 303);
        let success = !fail_store && !fail_exchange;
        assert_eq!(saved.load(Ordering::SeqCst), success);
        let location = response.headers()["location"].to_str().unwrap();
        assert_eq!(
            location,
            format!(
                "https://identity.example.test/oauth/result?status={}",
                if success { "success" } else { "failed" }
            )
        );
        for secret in [
            "test-code",
            "test-state",
            "test-access",
            "test-refresh",
            "test-verifier",
        ] {
            assert!(!location.contains(secret));
        }
        assert_eq!(response.headers()["referrer-policy"], "no-referrer");
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert_eq!(login.await.unwrap().is_ok(), success);
        exchange.await.unwrap();
    }

    #[tokio::test]
    async fn redirects_success_only_after_credentials_are_saved() {
        exchange_result(false, false).await;
    }
    #[tokio::test]
    async fn redirects_failure_when_keychain_fails() {
        exchange_result(true, false).await;
    }
    #[tokio::test]
    async fn redirects_failure_when_token_exchange_fails() {
        exchange_result(false, true).await;
    }
}

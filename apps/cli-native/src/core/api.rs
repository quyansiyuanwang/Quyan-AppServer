use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use hmac::{Hmac, Mac};
use reqwest::{Method, Url};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use sha2::Sha256;
use uuid::Uuid;

use crate::core::credentials::Credentials;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Deserialize)]
pub struct Envelope<T> {
    pub code: i64,
    pub message: String,
    pub data: Option<T>,
}

#[derive(Clone)]
pub struct ApiClient {
    pub api_base_url: String,
    pub relay_base_url: String,
    pub locale: String,
    pub credentials: Credentials,
    /// Swagger-generated endpoint client. Domain services use the wrapper
    /// below when they need custom auth/signing, while this remains the typed
    /// contract surface for generated operations.
    pub typed: crate::generated::Client,
    client: reqwest::Client,
}

impl ApiClient {
    pub fn new(credentials: Credentials, locale: &str) -> Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent(concat!("quyan/", env!("CARGO_PKG_VERSION")))
            .build()
            .context("failed to initialize HTTP client")?;
        Ok(Self {
            api_base_url: std::env::var("QUYAN_API_URL")
                .unwrap_or_else(|_| "https://api.qysyw.cn".into())
                .trim_end_matches('/')
                .into(),
            relay_base_url: std::env::var("QUYAN_RELAY_URL")
                .unwrap_or_else(|_| "https://ai.qysyw.cn".into())
                .trim_end_matches('/')
                .into(),
            locale: locale.into(),
            credentials,
            typed: crate::generated::Client::new(
                &std::env::var("QUYAN_API_URL").unwrap_or_else(|_| "https://api.qysyw.cn".into()),
            ),
            client,
        })
    }

    pub async fn request<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<serde_json::Value>,
        auth: AuthKind,
        relay: bool,
    ) -> Result<T> {
        let base = if relay {
            &self.relay_base_url
        } else {
            &self.api_base_url
        };
        let url = Url::parse(&format!("{}{}", base, normalize_path(path)))?;
        let request_id = Uuid::new_v4().to_string();
        let started = Instant::now();
        tracing::debug!(
            method = %method,
            path,
            request_id = %request_id,
            relay,
            "sending API request"
        );
        let mut request = self
            .client
            .request(method.clone(), url)
            .header("Accept", "application/json")
            .header("X-Locale", &self.locale)
            .header("X-Request-Id", &request_id);
        if let Some(token) = auth.token(&self.credentials) {
            request = request.bearer_auth(token);
        }
        if !matches!(method, Method::GET | Method::HEAD | Method::OPTIONS)
            && !path.contains("replay-signing-session")
        {
            if let Some(material) = self.replay_material().await? {
                tracing::debug!(path, "applying replay signing session");
                let nonce = Uuid::new_v4().to_string();
                let timestamp = chrono::Utc::now().timestamp().to_string();
                let body_text = body.as_ref().map(ToString::to_string).unwrap_or_default();
                let payload = format!("{nonce}{timestamp}{path}{body_text}");
                let mut mac = HmacSha256::new_from_slice(material.signing_key.as_bytes())
                    .map_err(|_| anyhow!("invalid replay signing key"))?;
                mac.update(payload.as_bytes());
                request = request
                    .header("X-Nonce", nonce)
                    .header("X-Timestamp", timestamp)
                    .header("X-Sign", hex::encode(mac.finalize().into_bytes()))
                    .header("X-Replay-Session-Id", material.session_id);
            }
        }
        if let Some(value) = body {
            request = request.json(&value);
        }
        let response = request.send().await.context("request failed")?;
        let status = response.status();
        tracing::debug!(
            method = %method,
            path,
            request_id = %request_id,
            status = %status,
            elapsed_ms = started.elapsed().as_millis(),
            "received API response"
        );
        let payload: serde_json::Value = response.json().await.context("invalid JSON response")?;
        if !status.is_success() {
            return Err(anyhow!("HTTP {}: {}", status, payload));
        }
        if payload.get("code").is_some() && payload.get("message").is_some() {
            let envelope: Envelope<T> = serde_json::from_value(payload)?;
            if envelope.code != 0 && envelope.code != 200 {
                return Err(anyhow!("API {}: {}", envelope.code, envelope.message));
            }
            return envelope
                .data
                .ok_or_else(|| anyhow!("API response contains no data"));
        }
        Ok(serde_json::from_value(payload)?)
    }

    async fn replay_material(&self) -> Result<Option<ReplayMaterial>> {
        tracing::debug!("requesting replay signing session");
        let token = AuthKind::OAuth.token(&self.credentials);
        let mut request = self.client.get(format!(
            "{}/v1/auth/replay-signing-session",
            self.api_base_url
        ));
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        let response = request.header("X-Locale", &self.locale).send().await?;
        if !response.status().is_success() {
            tracing::debug!(status = %response.status(), "replay signing session is unavailable");
            return Ok(None);
        }
        let value: serde_json::Value = response.json().await?;
        let data = value.get("data").cloned().unwrap_or(value);
        Ok(serde_json::from_value(data).ok())
    }
}

#[derive(Debug, serde::Deserialize)]
struct ReplayMaterial {
    session_id: String,
    signing_key: String,
}

fn normalize_path(path: &str) -> &str {
    path
}

#[derive(Clone, Copy)]
pub enum AuthKind {
    None,
    OAuth,
    AccessKey,
    RelayToken,
    ProductKey,
}

impl AuthKind {
    fn token(self, credentials: &Credentials) -> Option<&str> {
        match self {
            Self::None => None,
            Self::OAuth => credentials
                .access_token
                .as_deref()
                .or(credentials.access_key.as_deref()),
            Self::AccessKey => credentials.access_key.as_deref(),
            Self::RelayToken => credentials.relay_token.as_deref(),
            Self::ProductKey => credentials.product_key.as_deref(),
        }
    }
}

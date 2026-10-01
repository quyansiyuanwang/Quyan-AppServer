//! HTTP/SSE forwarding. Only configured Relay endpoints are reachable.
use super::{
    config::{self, RouterConfig},
    policy,
    profiles::ProfileSecrets,
    routing::{self, Protocol},
};
use anyhow::Result;
use axum::{
    body::{to_bytes, Body},
    extract::State,
    http::{HeaderMap, Method, Request, Response, StatusCode},
    routing::any,
    Router,
};
use bytes::Bytes;
use futures::{stream, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};
use tokio::sync::{watch, Mutex, RwLock, Semaphore};

#[derive(Clone)]
struct Snapshot {
    config: RouterConfig,
    secrets: HashMap<String, String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentRequest {
    pub protocol: String,
    pub model: String,
    pub profile_id: Option<String>,
    pub status: u16,
    pub attempts: usize,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Statistics {
    requests: u64,
    successes: u64,
    failures: u64,
    failovers: u64,
    stream_errors: u64,
    recent: VecDeque<RecentRequest>,
    health: HashMap<String, ProfileHealth>,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileHealth {
    consecutive_failures: u32,
    last_status: u16,
    #[serde(skip)]
    last_failure: Option<std::time::Instant>,
    #[serde(skip)]
    half_open_in_flight: bool,
}
fn health_key(profile: &str, protocol: Protocol, model: &str) -> String {
    format!("{profile}|{}|{model}", protocol.as_str())
}
pub struct Runtime {
    path: PathBuf,
    store: Arc<dyn ProfileSecrets>,
    snapshot: RwLock<Snapshot>,
    reload_guard: Mutex<()>,
    client: reqwest::Client,
    pub instance_id: String,
    control_token: String,
    pub shutdown: watch::Sender<bool>,
    stats: Mutex<Statistics>,
    active: Arc<AtomicU64>,
    permits: Arc<Semaphore>,
    started: std::time::Instant,
}
fn snapshot(path: &std::path::Path, store: &dyn ProfileSecrets) -> Result<Snapshot> {
    let config = config::load_at(path)?;
    let mut secrets = HashMap::new();
    for profile in config.profiles.iter().filter(|p| p.enabled) {
        secrets.insert(profile.id.clone(), store.get(&profile.id)?);
    }
    Ok(Snapshot { config, secrets })
}
impl Runtime {
    pub fn new(
        path: PathBuf,
        store: Arc<dyn ProfileSecrets>,
        instance_id: String,
        control_token: String,
    ) -> Result<Arc<Self>> {
        let current = snapshot(&path, store.as_ref())?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(policy::CONNECT_TIMEOUT)
            .build()?;
        let (shutdown, _) = watch::channel(false);
        Ok(Arc::new(Self {
            path,
            store,
            snapshot: RwLock::new(current),
            reload_guard: Mutex::new(()),
            client,
            instance_id,
            control_token,
            shutdown,
            stats: Mutex::new(Statistics::default()),
            active: Arc::new(AtomicU64::new(0)),
            permits: Arc::new(Semaphore::new(policy::MAX_CONCURRENT_REQUESTS)),
            started: std::time::Instant::now(),
        }))
    }
    pub async fn reload(&self) -> Result<()> {
        let _guard = self.reload_guard.lock().await;
        let path = self.path.clone();
        let config = tokio::task::spawn_blocking(move || config::load_at(&path)).await??;
        let current = self.snapshot.read().await;
        if config == current.config {
            return Ok(());
        }
        anyhow::ensure!(
            config.address() == current.config.address(),
            "Listening address changed; stop/start the Router to apply it"
        );
        drop(current);
        let store = self.store.clone();
        let next = tokio::task::spawn_blocking(move || {
            let mut secrets = HashMap::new();
            for profile in config.profiles.iter().filter(|p| p.enabled) {
                secrets.insert(profile.id.clone(), store.get(&profile.id)?);
            }
            Ok::<_, anyhow::Error>(Snapshot { config, secrets })
        })
        .await??;
        *self.snapshot.write().await = next;
        Ok(())
    }
    pub async fn status(&self) -> Value {
        let snapshot = self.snapshot.read().await;
        json!({"running":true,"instanceId":self.instance_id,"pid":std::process::id(),"baseUrl":snapshot.config.base_url(),"uptimeSeconds":self.started.elapsed().as_secs(),"activeRequests":self.active.load(Ordering::Relaxed),"statistics":*self.stats.lock().await,"profiles":snapshot.config.profiles,"routes":snapshot.config.routes})
    }
    async fn allow_candidate(&self, profile: &str, protocol: Protocol, model: &str) -> bool {
        let mut stats = self.stats.lock().await;
        let health = stats
            .health
            .entry(health_key(profile, protocol, model))
            .or_default();
        if health.consecutive_failures < policy::HEALTH_FAILURE_THRESHOLD {
            return true;
        }
        if health
            .last_failure
            .is_some_and(|time| time.elapsed() < policy::HEALTH_COOLDOWN)
        {
            return false;
        }
        if health.half_open_in_flight {
            return false;
        }
        health.half_open_in_flight = true;
        true
    }
    async fn attempt(&self, profile: &str, protocol: Protocol, model: &str, status: u16) {
        let mut stats = self.stats.lock().await;
        let health = stats
            .health
            .entry(health_key(profile, protocol, model))
            .or_default();
        health.last_status = status;
        health.half_open_in_flight = false;
        if policy::RETRY_STATUSES.contains(&status) {
            health.consecutive_failures = health.consecutive_failures.saturating_add(1);
            health.last_failure = Some(std::time::Instant::now());
        } else {
            health.consecutive_failures = 0;
            health.last_failure = None;
        }
    }
    async fn record(
        &self,
        protocol: Protocol,
        model: &str,
        profile_id: Option<String>,
        status: u16,
        attempts: usize,
    ) {
        let mut stats = self.stats.lock().await;
        stats.requests += 1;
        if status < 400 {
            stats.successes += 1;
        } else {
            stats.failures += 1;
        }
        stats.failovers += attempts.saturating_sub(1) as u64;
        if stats.recent.len() >= policy::RECENT_REQUEST_LIMIT {
            stats.recent.pop_back();
        }
        stats.recent.push_front(RecentRequest {
            protocol: protocol.as_str().into(),
            model: model.into(),
            profile_id,
            status,
            attempts,
        });
        tracing::debug!(
            protocol = protocol.as_str(),
            status,
            attempts,
            "Router request completed"
        );
    }
}

pub fn app(runtime: Arc<Runtime>) -> Router {
    Router::new().fallback(any(dispatch)).with_state(runtime)
}
fn error(status: StatusCode, message: &str) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .header("cache-control", "no-store")
        .body(Body::from(
            json!({"type":"error","error":{"type":"router_error","message":message}}).to_string(),
        ))
        .unwrap()
}
fn json_response(value: Value) -> Response<Body> {
    Response::builder()
        .header("content-type", "application/json")
        .header("cache-control", "no-store")
        .body(Body::from(value.to_string()))
        .unwrap()
}
fn api_key(headers: &HeaderMap) -> Option<&str> {
    for name in ["authorization", "x-api-key", "x-goog-api-key"] {
        if headers.get_all(name).iter().count() > 1 {
            return None;
        }
    }

    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .or_else(|| headers.get("x-api-key").and_then(|v| v.to_str().ok()))
        .or_else(|| headers.get("x-goog-api-key").and_then(|v| v.to_str().ok()))
}
fn browser_or_invalid_host(headers: &HeaderMap) -> bool {
    if headers.contains_key("origin") || headers.contains_key("sec-fetch-site") {
        return true;
    }
    let Some(host) = headers.get("host").and_then(|v| v.to_str().ok()) else {
        return true;
    };
    let Ok(url) = url::Url::parse(&format!("http://{host}")) else {
        return true;
    };
    url.host_str().is_none_or(|host| {
        let host = host.trim_matches(['[', ']']);
        host.parse::<std::net::IpAddr>()
            .map_or(true, |ip| !ip.is_loopback())
    })
}
async fn dispatch(State(runtime): State<Arc<Runtime>>, request: Request<Body>) -> Response<Body> {
    if browser_or_invalid_host(request.headers()) {
        return error(
            StatusCode::FORBIDDEN,
            "Only non-browser loopback clients are supported",
        );
    }
    let raw_path = request.uri().path();
    let path = raw_path
        .strip_prefix("/claude-desktop")
        .unwrap_or(raw_path)
        .to_string();
    let method = request.method().clone();
    if path == "/health" && method == Method::GET {
        return json_response(
            json!({"service":"quyan-router","instanceId":runtime.instance_id,"running":true}),
        );
    }
    if path.starts_with("/_quyan/") {
        if request
            .headers()
            .get("x-quyan-control")
            .and_then(|v| v.to_str().ok())
            != Some(runtime.control_token.as_str())
        {
            return error(
                StatusCode::UNAUTHORIZED,
                "Router control authentication required",
            );
        }
        return match (method.as_str(), path.as_str()) {
            ("GET", "/_quyan/status") => json_response(runtime.status().await),
            ("POST", "/_quyan/reload") => match runtime.reload().await {
                Ok(()) => json_response(json!({"reloaded":true})),
                Err(_) => error(
                    StatusCode::CONFLICT,
                    "Reload rejected; previous configuration remains active",
                ),
            },
            ("POST", "/_quyan/stop") => {
                let _ = runtime.shutdown.send(true);
                json_response(json!({"stopping":true}))
            }
            _ => error(StatusCode::NOT_FOUND, "Unknown Router control endpoint"),
        };
    }
    let query_key = request.uri().query().and_then(|q| {
        url::form_urlencoded::parse(q.as_bytes())
            .find(|(k, _)| k == "key")
            .map(|(_, v)| v.into_owned())
    });
    let header_key = api_key(request.headers());
    let authorized = header_key == Some(config::LOCAL_API_KEY)
        || (header_key.is_none()
            && ["authorization", "x-api-key", "x-goog-api-key"]
                .iter()
                .all(|name| !request.headers().contains_key(*name))
            && path.starts_with("/v1beta/models/")
            && query_key.as_deref() == Some(config::LOCAL_API_KEY));
    if !authorized {
        return error(
            StatusCode::UNAUTHORIZED,
            "Use the Quyan local compatibility key, not a Relay Token",
        );
    }
    // Every request observes a newly saved valid config. Invalid edits never
    // discard the last good snapshot or expose parser/credential error text.
    if runtime.reload().await.is_err() {
        tracing::warn!("Router retained last valid configuration");
    }
    let snapshot = runtime.snapshot.read().await.clone();
    if !snapshot.config.active {
        return error(StatusCode::SERVICE_UNAVAILABLE, "Local routing is paused");
    }
    if path == "/v1/models" && method == Method::GET {
        let model_protocol = request.uri().query().and_then(|query| {
            url::form_urlencoded::parse(query.as_bytes())
                .find(|(k, _)| k == "protocol")
                .map(|(_, v)| v.into_owned())
        });
        let protocol = match model_protocol.as_deref() {
            Some("anthropic") => Protocol::Anthropic,
            Some("gemini") => Protocol::Gemini,
            Some("openai-responses") => Protocol::OpenaiResponses,
            _ => Protocol::Openai,
        };
        let models = routing::aggregate_models(&snapshot.config, protocol);
        return json_response(
            json!({"object":"list","data":models.iter().map(|m| json!({"id":m,"object":"model","owned_by":"quyan-router"})).collect::<Vec<_>>()}),
        );
    }
    let Some((protocol, path_model, gemini_action)) = parse_path(&path) else {
        return error(StatusCode::NOT_FOUND, "Unsupported local AI endpoint");
    };
    if method != Method::POST {
        return error(
            StatusCode::METHOD_NOT_ALLOWED,
            "This AI endpoint requires POST",
        );
    }
    let Ok(permit) = runtime.permits.clone().try_acquire_owned() else {
        return error(
            StatusCode::TOO_MANY_REQUESTS,
            "Local Router concurrency limit reached",
        );
    };
    let headers = request.headers().clone();
    let query = request.uri().query().map(str::to_owned);
    let bytes = match tokio::time::timeout(
        policy::REQUEST_BODY_TIMEOUT,
        to_bytes(request.into_body(), policy::MAX_REQUEST_BYTES),
    )
    .await
    {
        Ok(Ok(bytes)) => bytes,
        Err(_) => return error(StatusCode::REQUEST_TIMEOUT, "Request body timed out"),
        Ok(Err(_)) => {
            return error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Request exceeds the local Router body limit",
            )
        }
    };
    let body: Value = match serde_json::from_slice(&bytes) {
        Ok(Value::Object(value)) => Value::Object(value),
        _ => return error(StatusCode::BAD_REQUEST, "Expected a JSON object"),
    };
    let model = path_model.or_else(|| body["model"].as_str().map(str::to_owned));
    let Some(model) = model.filter(|m| config::valid_model(m)) else {
        return error(StatusCode::BAD_REQUEST, "A valid model ID is required");
    };
    let mut candidates = routing::candidates(&snapshot.config, protocol, &model);
    if candidates.is_empty() {
        return error(
            StatusCode::BAD_REQUEST,
            &format!(
                "Model unavailable for {}; {} available models",
                protocol.as_str(),
                routing::aggregate_models(&snapshot.config, protocol).len()
            ),
        );
    }
    let mut healthy = Vec::new();
    for candidate in &candidates {
        if runtime
            .allow_candidate(&candidate.profile_id, protocol, &candidate.model)
            .await
        {
            healthy.push(candidate.clone());
        }
    }
    candidates = healthy;

    if candidates.is_empty() {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "All matching Router profiles are temporarily circuit-open",
        );
    }
    for (index, candidate) in candidates.iter().enumerate() {
        let profile = snapshot
            .config
            .profiles
            .iter()
            .find(|p| p.id == candidate.profile_id)
            .unwrap();
        let Some(secret) = snapshot.secrets.get(&profile.id) else {
            runtime
                .attempt(&profile.id, protocol, &candidate.model, 503)
                .await;
            continue;
        };
        let mut forward_body = body.clone();
        if protocol != Protocol::Gemini {
            forward_body["model"] = Value::String(candidate.model.clone());
        }
        let root = match crate::features::integrations::endpoint(&profile.relay_base_url, false) {
            Ok(root) => root,
            Err(_) => {
                runtime
                    .attempt(&profile.id, protocol, &candidate.model, 502)
                    .await;
                continue;
            }
        };
        let url = if protocol == Protocol::Gemini {
            let mut url = url::Url::parse(&root).unwrap();
            if let Ok(mut segments) = url.path_segments_mut() {
                segments
                    .pop_if_empty()
                    .push("v1beta")
                    .push("models")
                    .push(&format!("{}:{}", candidate.model, gemini_action.unwrap()));
            }
            // Only the protocol's streaming selector is forwarded; API keys in
            // a query string are never copied to the Relay request.
            if query.as_deref().is_some_and(|q| {
                url::form_urlencoded::parse(q.as_bytes()).any(|(k, v)| k == "alt" && v == "sse")
            }) {
                url.set_query(Some("alt=sse"));
            }
            url.to_string()
        } else {
            format!("{root}{path}")
        };
        let mut outgoing = runtime
            .client
            .post(url)
            .bearer_auth(secret)
            .json(&forward_body);
        for name in [
            "accept",
            "anthropic-version",
            "anthropic-beta",
            "openai-beta",
            "x-request-id",
        ] {
            if let Some(value) = headers.get(name) {
                outgoing = outgoing.header(name, value);
            }
        }
        let upstream =
            match tokio::time::timeout(policy::RESPONSE_HEADER_TIMEOUT, outgoing.send()).await {
                Ok(Ok(response)) => response,
                _ if index + 1 < candidates.len() => {
                    runtime
                        .attempt(&profile.id, protocol, &candidate.model, 504)
                        .await;
                    continue;
                }
                _ => {
                    runtime.record(protocol, &model, None, 504, index + 1).await;
                    return error(
                        StatusCode::GATEWAY_TIMEOUT,
                        "Relay request timed out or could not connect",
                    );
                }
            };
        let status = upstream.status();
        runtime
            .attempt(&profile.id, protocol, &candidate.model, status.as_u16())
            .await;
        if policy::RETRY_STATUSES.contains(&status.as_u16()) && index + 1 < candidates.len() {
            continue;
        }
        // Redirects are never followed with credential-bearing requests.
        if status.is_redirection() {
            runtime
                .record(protocol, &model, Some(profile.id.clone()), 502, index + 1)
                .await;
            return error(StatusCode::BAD_GATEWAY, "Relay redirect refused");
        }
        runtime
            .record(
                protocol,
                &model,
                Some(profile.id.clone()),
                status.as_u16(),
                index + 1,
            )
            .await;
        let mut response = Response::builder().status(status);
        for (name, value) in upstream.headers() {
            if matches!(
                name.as_str(),
                "content-type"
                    | "cache-control"
                    | "retry-after"
                    | "x-request-id"
                    | "request-id"
                    | "anthropic-ratelimit-requests-remaining"
                    | "x-accel-buffering"
            ) {
                if let Ok(value) = value.to_str() {
                    response = response.header(name, value.replace(secret, "[REDACTED]"));
                }
            }
        }
        response = response.header("x-accel-buffering", "no");
        runtime.active.fetch_add(1, Ordering::Relaxed);
        let active = ActiveGuard(runtime.active.clone());
        let upstream = upstream.bytes_stream().boxed();
        let redactor = Redactor::new(secret.as_bytes());
        let output = stream::unfold(
            (upstream, redactor, Some((permit, active)), runtime.clone()),
            |(mut input, mut redactor, guard, runtime)| async move {
                loop {
                    match tokio::time::timeout(policy::STREAM_IDLE_TIMEOUT, input.next()).await {
                        Ok(Some(Ok(bytes))) => {
                            let output = redactor.feed(&bytes, false);
                            if !output.is_empty() {
                                return Some((
                                    Ok::<_, std::io::Error>(Bytes::from(output)),
                                    (input, redactor, guard, runtime),
                                ));
                            }
                        }
                        Ok(None) => {
                            let tail = redactor.feed(&[], true);
                            if tail.is_empty() {
                                return None;
                            }
                            return Some((
                                Ok(Bytes::from(tail)),
                                (stream::empty().boxed(), Redactor::new(&[]), guard, runtime),
                            ));
                        }
                        _ => {
                            runtime.stats.lock().await.stream_errors += 1;
                            return Some((
                                Err(std::io::Error::other("Relay stream interrupted")),
                                (stream::empty().boxed(), Redactor::new(&[]), guard, runtime),
                            ));
                        }
                    }
                }
            },
        );
        return response.body(Body::from_stream(output)).unwrap();
    }
    error(
        StatusCode::SERVICE_UNAVAILABLE,
        "No usable profile credential",
    )
}
struct ActiveGuard(Arc<AtomicU64>);
impl Drop for ActiveGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}
fn parse_path(path: &str) -> Option<(Protocol, Option<String>, Option<&str>)> {
    match path {
        "/v1/chat/completions" => Some((Protocol::Openai, None, None)),
        "/v1/responses" => Some((Protocol::OpenaiResponses, None, None)),
        "/v1/messages" => Some((Protocol::Anthropic, None, None)),
        _ => {
            let value = path.strip_prefix("/v1beta/models/")?;
            let (model, action) = value.rsplit_once(':')?;
            if model.is_empty()
                || model.contains('/')
                || !matches!(action, "generateContent" | "streamGenerateContent")
            {
                return None;
            }
            let model = url::Url::parse(&format!("http://localhost/{model}"))
                .ok()?
                .path()
                .trim_start_matches('/')
                .to_string();
            Some((Protocol::Gemini, Some(model), Some(action)))
        }
    }
}
/// Holds only a suffix that could be a partial credential, preserving SSE
/// framing while masking a credential split across arbitrary upstream chunks.
struct Redactor {
    secret: Vec<u8>,
    pending: Vec<u8>,
}
impl Redactor {
    fn new(secret: &[u8]) -> Self {
        Self {
            secret: secret.to_vec(),
            pending: Vec::new(),
        }
    }
    fn feed(&mut self, bytes: &[u8], end: bool) -> Vec<u8> {
        self.pending.extend_from_slice(bytes);
        let mut output = Vec::new();
        if self.secret.is_empty() {
            return std::mem::take(&mut self.pending);
        }
        let mut cursor = 0;
        while cursor + self.secret.len() <= self.pending.len() {
            if self.pending[cursor..].starts_with(&self.secret) {
                output.extend_from_slice(b"[REDACTED]");
                cursor += self.secret.len();
            } else {
                output.push(self.pending[cursor]);
                cursor += 1;
            }
        }
        let tail = &self.pending[cursor..];
        let hold = if end {
            0
        } else {
            (1..=tail.len())
                .rev()
                .find(|n| self.secret.starts_with(&tail[tail.len() - n..]))
                .unwrap_or(0)
        };
        let flush = self.pending.len() - hold;
        output.extend_from_slice(&self.pending[cursor..flush]);
        self.pending.drain(..flush);
        output
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gemini_paths_and_streaming_action_are_recognized() {
        assert_eq!(
            parse_path("/v1beta/models/gemini-test:streamGenerateContent")
                .unwrap()
                .0,
            Protocol::Gemini
        );
        assert!(parse_path("/v1/messages/../../admin").is_none());
    }
    #[test]
    fn redaction_preserves_sse_and_handles_chunk_boundaries() {
        let mut r = Redactor::new(b"rlt_fixture_secret");
        assert_eq!(r.feed(b"data: first\n\n", false), b"data: first\n\n");
        assert!(r.feed(b"rlt_fixt", false).is_empty());
        assert_eq!(r.feed(b"ure_secret\n\n", false), b"[REDACTED]\n\n");
    }
}

//! Entirely local fixtures: no live Relay, credentials, user configs or agents.
use super::{
    config::{self, RouterConfig, RouterModels, RouterProfile, RouterRoute, LOCAL_API_KEY},
    profiles::{fixtures::MemorySecrets, ProfileSecrets},
    proxy::{self, Runtime},
    routing::Protocol,
};
use axum::{
    body::{to_bytes, Body},
    extract::State,
    http::{Request, Response},
    routing::any,
    Router,
};
use futures::{stream, StreamExt};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct Mock {
    status: u16,
    requests: Mutex<Vec<(String, Value, String)>>,
}
async fn mock_request(State(mock): State<Arc<Mock>>, request: Request<Body>) -> Response<Body> {
    let path = request.uri().to_string();
    let auth = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let body: Value = serde_json::from_slice(
        &to_bytes(request.into_body(), super::policy::MAX_REQUEST_BYTES)
            .await
            .unwrap(),
    )
    .unwrap();
    mock.requests
        .lock()
        .unwrap()
        .push((path, body.clone(), auth.clone()));
    if mock.status != 0 {
        return Response::builder()
            .status(mock.status)
            .header("location", "https://untrusted.example.test")
            .body(Body::from(json!({"error":"fixture rejection"}).to_string()))
            .unwrap();
    }
    if body["stream"] == true {
        let chunks = stream::unfold(0, |step| async move {
            match step {
                0 => Some((Ok::<_, std::io::Error>("data: first\n\n".to_string()), 1)),
                1 => {
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    Some((Ok("data: second\n\n".to_string()), 2))
                }
                _ => None,
            }
        });
        return Response::builder()
            .header("content-type", "text/event-stream")
            .body(Body::from_stream(chunks))
            .unwrap();
    }
    Response::builder()
        .header("content-type", "application/json")
        .header("x-request-id", "fixture-request")
        .body(Body::from(
            json!({"model":body["model"],"echo":auth}).to_string(),
        ))
        .unwrap()
}
async fn mock(status: u16) -> (String, Arc<Mock>, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let state = Arc::new(Mock {
        status,
        ..Default::default()
    });
    let app = Router::new()
        .fallback(any(mock_request))
        .with_state(state.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (base, state, task)
}
struct TestRouter {
    base: String,
    config_path: std::path::PathBuf,
    _dir: tempfile::TempDir,
    runtime: Arc<Runtime>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for TestRouter {
    fn drop(&mut self) {
        self.task.abort();
    }
}
fn profile(id: &str, url: &str, priority: i32) -> RouterProfile {
    RouterProfile {
        id: id.into(),
        name: id.into(),
        relay_token_id: id.into(),
        relay_base_url: url.into(),
        enabled: true,
        priority,
        models: RouterModels {
            openai: vec!["test-model".into(), "real".into()],
            openai_responses: vec!["test-model".into()],
            anthropic: vec!["test-model".into()],
            gemini: vec!["test-model".into(), "real".into()],
        },
        last_models_refresh_at: None,
    }
}
async fn router(profiles: Vec<RouterProfile>, routes: Vec<RouterRoute>) -> TestRouter {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("router.json");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let config = RouterConfig {
        listen_port: port,
        profiles,
        routes,
        ..Default::default()
    };
    config::update_at(&path, |c| {
        *c = config.clone();
        Ok(())
    })
    .unwrap();
    let secrets = Arc::new(MemorySecrets::default());
    for profile in &config.profiles {
        secrets
            .set(&profile.id, &format!("rlt_fixture_{}", profile.id))
            .unwrap();
    }
    let runtime = Runtime::new(
        path.clone(),
        secrets,
        "test-instance".into(),
        "test-control-nonce".into(),
    )
    .unwrap();
    let app = proxy::app(runtime.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    TestRouter {
        base: format!("http://127.0.0.1:{port}"),
        config_path: path,
        _dir: dir,
        runtime,
        task,
    }
}
fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}
async fn request(router: &TestRouter, path: &str, model: &str) -> reqwest::Response {
    client()
        .post(format!("{}{path}", router.base))
        .bearer_auth(LOCAL_API_KEY)
        .json(&json!({"model":model}))
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn protocols_streams_authorization_and_response_redaction() {
    let (url, mock, task) = mock(0).await;
    let router = router(vec![profile("one", &url, 0)], Vec::new()).await;
    for endpoint in [
        "/v1/chat/completions",
        "/v1/responses",
        "/v1/messages",
        "/claude-desktop/v1/messages",
        "/v1beta/models/test-model:generateContent",
    ] {
        let response = request(&router, endpoint, "test-model").await;
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["x-request-id"], "fixture-request");
        let body = response.text().await.unwrap();
        assert!(body.contains("[REDACTED]"));
        assert!(!body.contains("rlt_fixture"));
    }
    assert!(mock
        .requests
        .lock()
        .unwrap()
        .iter()
        .all(|(_, _, auth)| auth == "Bearer rlt_fixture_one"));
    let response = client()
        .post(format!("{}/v1/messages", router.base))
        .bearer_auth(LOCAL_API_KEY)
        .json(&json!({"model":"test-model","stream":true}))
        .send()
        .await
        .unwrap();
    let mut stream = response.bytes_stream();
    let first = tokio::time::timeout(std::time::Duration::from_millis(150), stream.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(first, "data: first\n\n");
    assert_eq!(stream.next().await.unwrap().unwrap(), "data: second\n\n");
    assert!(stream.next().await.is_none());
    task.abort();
}
#[tokio::test]
async fn retryable_errors_failover_but_client_errors_and_redirects_do_not() {
    for status in [408, 429, 500, 502, 503, 504, 400, 401, 403, 302] {
        let (a, first, t1) = mock(status).await;
        let (b, second, t2) = mock(0).await;
        let router = router(vec![profile("a", &a, 0), profile("b", &b, 1)], Vec::new()).await;
        let response = request(&router, "/v1/chat/completions", "test-model").await;
        let retry = super::policy::RETRY_STATUSES.contains(&status);
        assert_eq!(
            response.status().as_u16(),
            if retry {
                200
            } else if status == 302 {
                502
            } else {
                status
            }
        );
        assert_eq!(first.requests.lock().unwrap().len(), 1);
        assert_eq!(second.requests.lock().unwrap().len(), usize::from(retry));
        t1.abort();
        t2.abort();
    }
}
#[tokio::test]
async fn routing_changes_apply_to_next_request_and_invalid_edits_retain_snapshot() {
    let (a, first, t1) = mock(0).await;
    let (b, second, t2) = mock(0).await;
    let router = router(vec![profile("a", &a, 0), profile("b", &b, 1)], Vec::new()).await;
    assert_eq!(
        request(&router, "/v1/chat/completions", "test-model")
            .await
            .status(),
        200
    );
    config::update_at(&router.config_path, |c| {
        c.routes.push(RouterRoute {
            protocol: Protocol::Openai,
            model: "test-model".into(),
            profile_id: "b".into(),
            upstream_model: Some("real".into()),
            priority: 0,
        });
        Ok(())
    })
    .unwrap();
    assert_eq!(
        request(&router, "/v1/chat/completions", "test-model")
            .await
            .status(),
        200
    );
    assert_eq!(first.requests.lock().unwrap().len(), 1);
    assert_eq!(second.requests.lock().unwrap()[0].1["model"], "real");
    std::fs::write(&router.config_path, "malformed").unwrap();
    assert_eq!(
        request(&router, "/v1/chat/completions", "test-model")
            .await
            .status(),
        200
    );
    assert_eq!(second.requests.lock().unwrap().len(), 2);
    t1.abort();
    t2.abort();
}
#[tokio::test]
async fn aliases_catalog_dedup_and_gemini_path_rewrite() {
    let (url, state, task) = mock(0).await;
    let router = router(
        vec![profile("one", &url, 0), profile("two", &url, 1)],
        vec![RouterRoute {
            protocol: Protocol::Gemini,
            model: "alias".into(),
            profile_id: "one".into(),
            upstream_model: Some("real".into()),
            priority: 0,
        }],
    )
    .await;
    let models: Value = client()
        .get(format!("{}/v1/models?protocol=gemini", router.base))
        .bearer_auth(LOCAL_API_KEY)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(models["data"].as_array().unwrap().len(), 3);
    assert_eq!(
        request(
            &router,
            "/v1beta/models/alias:streamGenerateContent?alt=sse&key=must-not-forward",
            "unused"
        )
        .await
        .status(),
        200
    );
    assert_eq!(
        state.requests.lock().unwrap()[0].0,
        "/v1beta/models/real:streamGenerateContent?alt=sse"
    );
    assert_eq!(
        request(&router, "/v1/chat/completions", "unknown")
            .await
            .status(),
        400
    );
    task.abort();
}
#[tokio::test]
async fn browser_dns_rebinding_bad_auth_and_control_are_rejected() {
    let (url, state, task) = mock(0).await;
    let router = router(vec![profile("one", &url, 0)], Vec::new()).await;
    let client = client();
    for (header, value, status) in [
        ("origin", "https://hostile.example.test", 403),
        ("host", "hostile.example.test", 403),
        (
            "authorization",
            "Bearer rlt_account_should_not_be_used",
            401,
        ),
    ] {
        let response = client
            .post(format!("{}/v1/messages", router.base))
            .bearer_auth(LOCAL_API_KEY)
            .header(header, value)
            .json(&json!({"model":"test-model"}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), status);
    }
    assert!(state.requests.lock().unwrap().is_empty());
    assert_eq!(
        client
            .post(format!("{}/_quyan/stop", router.base))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        client
            .post(format!("{}/_quyan/reload", router.base))
            .header("x-quyan-control", "test-control-nonce")
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    let status = router.runtime.status().await.to_string();
    assert!(!status.contains("rlt_fixture"));
    assert!(!status.contains("test-control-nonce"));
    task.abort();
}

#[tokio::test]
async fn connection_failure_can_failover_without_restarting_the_router() {
    let unused = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let unreachable = format!("http://{}", unused.local_addr().unwrap());
    drop(unused);
    let (working, state, task) = mock(0).await;
    let router = router(
        vec![profile("a", &unreachable, 0), profile("b", &working, 1)],
        Vec::new(),
    )
    .await;
    assert_eq!(
        request(&router, "/v1/messages", "test-model")
            .await
            .status(),
        200
    );
    assert_eq!(state.requests.lock().unwrap().len(), 1);
    task.abort();
}

#[tokio::test]
async fn health_is_scoped_by_model_and_protocol_and_can_deprioritize_repeated_failures() {
    let (a, first, t1) = mock(503).await;
    let (b, second, t2) = mock(0).await;
    let router = router(vec![profile("a", &a, 0), profile("b", &b, 1)], Vec::new()).await;
    for _ in 0..4 {
        assert_eq!(
            request(&router, "/v1/messages", "test-model")
                .await
                .status(),
            200
        );
    }
    assert_eq!(first.requests.lock().unwrap().len(), 3);
    assert_eq!(second.requests.lock().unwrap().len(), 4);
    assert_eq!(
        request(&router, "/v1/chat/completions", "test-model")
            .await
            .status(),
        200
    );
    assert_eq!(first.requests.lock().unwrap().len(), 4);
    t1.abort();
    t2.abort();
}

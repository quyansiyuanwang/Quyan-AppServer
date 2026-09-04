use anyhow::Result;
use reqwest::Method;
use serde_json::{json, Value};

use crate::api::{ApiClient, AuthKind};

pub async fn tokens(api: &ApiClient) -> Result<Value> {
    api.request(
        Method::GET,
        "/v1/relay/tokens?page=1&pageSize=50",
        None,
        AuthKind::OAuth,
        false,
    )
    .await
}
pub async fn create_token(api: &ApiClient) -> Result<Value> {
    api.request(
        Method::POST,
        "/v1/relay/tokens",
        Some(json!({"name":"Quyan CLI token"})),
        AuthKind::OAuth,
        false,
    )
    .await
}
pub async fn update_token(api: &ApiClient, id: &str, body: Value) -> Result<Value> {
    api.request(
        Method::PUT,
        &format!("/v1/relay/tokens/{id}"),
        Some(body),
        AuthKind::OAuth,
        false,
    )
    .await
}
pub async fn delete_token(api: &ApiClient, id: &str) -> Result<Value> {
    api.request(
        Method::DELETE,
        &format!("/v1/relay/tokens/{id}"),
        None,
        AuthKind::OAuth,
        false,
    )
    .await
}
pub async fn token_usage(api: &ApiClient, id: &str) -> Result<Value> {
    api.request(
        Method::GET,
        &format!("/v1/relay/tokens/{id}/usage"),
        None,
        AuthKind::OAuth,
        false,
    )
    .await
}
pub async fn channels(api: &ApiClient) -> Result<Value> {
    api.request(
        Method::GET,
        "/v1/relay-channels/routing-catalog",
        None,
        AuthKind::OAuth,
        false,
    )
    .await
}

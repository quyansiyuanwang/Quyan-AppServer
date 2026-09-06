use anyhow::Result;
use reqwest::Method;
use serde_json::{json, Value};

use crate::core::api::{ApiClient, AuthKind};

pub async fn get(api: &ApiClient) -> Result<Value> {
    api.request(
        Method::GET,
        "/v1/products/json-endpoints",
        None,
        AuthKind::ProductKey,
        false,
    )
    .await
}
pub async fn update(api: &ApiClient, value: Value) -> Result<Value> {
    api.request(
        Method::PUT,
        "/v1/products/json-endpoints",
        Some(json!({"jsonContent": value})),
        AuthKind::ProductKey,
        false,
    )
    .await
}
pub async fn clear(api: &ApiClient) -> Result<Value> {
    api.request(
        Method::DELETE,
        "/v1/products/json-endpoints",
        None,
        AuthKind::ProductKey,
        false,
    )
    .await
}
pub async fn usage(api: &ApiClient) -> Result<Value> {
    api.request(
        Method::GET,
        "/v1/products/json-endpoints/usage",
        None,
        AuthKind::ProductKey,
        false,
    )
    .await
}

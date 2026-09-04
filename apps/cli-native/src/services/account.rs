use anyhow::Result;
use reqwest::Method;
use serde_json::Value;

use crate::api::{ApiClient, AuthKind};

pub async fn profile(api: &ApiClient) -> Result<Value> {
    api.request(
        Method::GET,
        "/v1/users/me/profile",
        None,
        AuthKind::OAuth,
        false,
    )
    .await
}
pub async fn balance(api: &ApiClient) -> Result<Value> {
    api.request(
        Method::GET,
        "/v1/balance/account",
        None,
        AuthKind::OAuth,
        false,
    )
    .await
}
pub async fn usage(api: &ApiClient) -> Result<Value> {
    api.request(
        Method::GET,
        "/v1/balance/usage",
        None,
        AuthKind::OAuth,
        false,
    )
    .await
}

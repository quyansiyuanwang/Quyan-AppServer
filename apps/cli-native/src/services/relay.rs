use anyhow::Result;
use chrono::Utc;
use reqwest::Method;
use serde_json::{json, Value};

use crate::core::api::{ApiClient, AuthKind};
use crate::utils::charts;

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

pub async fn create_token(api: &ApiClient, name: Option<String>, channels: Option<String>, failover: bool, max_retries: Option<u32>, preflight_buffer_mb: Option<f32>) -> Result<Value> {
    let mut body = json!({
        "name": name.unwrap_or_else(|| "Quyan CLI token".to_string())
    });

    if let Some(channels_str) = channels {
        let channel_ids: Vec<String> = channels_str.split(',').map(|s| s.trim().to_string()).collect();
        body["routingChannelIds"] = json!(channel_ids);
    }

    if failover {
        let failover_config = json!({
            "enabled": true,
            "maxRetries": max_retries.unwrap_or(2)
        });
        body["failoverConfig"] = failover_config;
    }

    if let Some(buffer_mb) = preflight_buffer_mb {
        let buffer_bytes = (buffer_mb * 1024.0 * 1024.0) as u64;
        body["streamConfig"] = json!({
            "preflightBufferLimitBytes": buffer_bytes
        });
    }

    api.request(
        Method::POST,
        "/v1/relay/tokens",
        Some(body),
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

pub async fn delete_batch_tokens(api: &ApiClient, ids: &str) -> Result<Value> {
    let id_list: Vec<&str> = ids.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    let mut results = Vec::new();
    let mut errors = Vec::new();

    for id in id_list {
        match delete_token(api, id).await {
            Ok(_) => results.push(json!({"id": id, "status": "deleted"})),
            Err(e) => errors.push(json!({"id": id, "error": e.to_string()})),
        }
    }

    Ok(json!({
        "deleted": results,
        "errors": errors,
        "total": results.len() + errors.len(),
        "success": results.len(),
        "failed": errors.len()
    }))
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

pub async fn token_stats(api: &ApiClient, id: Option<&str>) -> Result<Value> {
    if let Some(token_id) = id {
        // Single token detailed stats
        let usage: Value = api.request(
            Method::GET,
            &format!("/v1/relay/tokens/{token_id}/usage"),
            None,
            AuthKind::OAuth,
            false,
        )
        .await?;

        Ok(json!({
            "tokenId": token_id,
            "usage": usage,
            "timestamp": chrono::Utc::now().to_rfc3339()
        }))
    } else {
        // All tokens summary stats
        let tokens_response = tokens(api).await?;
        let items = tokens_response.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();

        let mut total_requests = 0u64;
        let mut total_tokens = 0u64;
        let mut active_tokens = 0u64;

        for token in &items {
            if token.get("status").and_then(|s| s.as_str()) == Some("enabled") {
                active_tokens += 1;
            }
            if let Some(req) = token.get("requestCount").and_then(|v| v.as_u64()) {
                total_requests += req;
            }
            if let Some(tok) = token.get("totalTokens").and_then(|v| v.as_u64()) {
                total_tokens += tok;
            }
        }

        Ok(json!({
            "summary": {
                "totalTokens": items.len(),
                "activeTokens": active_tokens,
                "totalRequests": total_requests,
                "totalTokensUsed": total_tokens
            },
            "tokens": items,
            "timestamp": chrono::Utc::now().to_rfc3339()
        }))
    }
}

pub async fn export_tokens(api: &ApiClient) -> Result<Value> {
    let tokens_response = tokens(api).await?;
    let channels_response = channels(api).await?;

    Ok(json!({
        "version": "1.0",
        "exportedAt": chrono::Utc::now().to_rfc3339(),
        "tokens": tokens_response.get("items").cloned().unwrap_or(json!([])),
        "channels": channels_response.get("channels").cloned().unwrap_or(json!([]))
    }))
}

pub async fn health_check(api: &ApiClient, id: &str) -> Result<Value> {
    let start = std::time::Instant::now();

    // Get token details
    let token_result: Result<Value> = api.request(
        Method::GET,
        &format!("/v1/relay/tokens/{id}"),
        None,
        AuthKind::OAuth,
        false,
    )
    .await;

    let token_healthy = token_result.is_ok();
    let token_status = if let Ok(ref token) = token_result {
        token.get("status").and_then(|s: &Value| s.as_str()).unwrap_or("unknown")
    } else {
        "error"
    };

    // Try to get usage to test token validity
    let usage_result = token_usage(api, id).await;
    let usage_healthy = usage_result.is_ok();

    let elapsed = start.elapsed();
    let overall_healthy = token_healthy && usage_healthy && token_status == "enabled";

    Ok(json!({
        "tokenId": id,
        "healthy": overall_healthy,
        "status": token_status,
        "checks": {
            "tokenExists": token_healthy,
            "usageAccessible": usage_healthy,
            "statusEnabled": token_status == "enabled"
        },
        "responseTime": format!("{:.2}ms", elapsed.as_secs_f64() * 1000.0),
        "timestamp": Utc::now().to_rfc3339(),
        "details": if overall_healthy {
            "All checks passed"
        } else {
            "One or more checks failed"
        }
    }))
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

pub async fn visualize_stats(api: &ApiClient, plain_output: bool) -> Result<String> {
    let tokens_response = tokens(api).await?;
    let items = tokens_response
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    if plain_output {
        // Return JSON for --json mode
        return Ok(serde_json::to_string_pretty(&tokens_response)?);
    }

    let mut output = String::new();
    output.push_str("📊 Relay Token Usage Statistics\n");
    output.push_str("================================\n\n");

    // Collect data for visualization
    let mut token_data: Vec<(String, u64)> = Vec::new();
    let mut total_requests = 0u64;
    let mut total_tokens = 0u64;
    let mut active_count = 0u64;

    for token in &items {
        let name = token
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown");
        let requests = token
            .get("requestCount")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let tokens_used = token
            .get("totalTokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let status = token
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");

        if status == "enabled" {
            active_count += 1;
        }

        total_requests += requests;
        total_tokens += tokens_used;

        // Truncate long names for display
        let display_name = if name.len() > 18 {
            format!("{}...", &name[..15])
        } else {
            name.to_string()
        };

        token_data.push((display_name, requests));
    }

    // Summary stats
    output.push_str(&format!("Total Tokens: {}\n", items.len()));
    output.push_str(&format!("Active Tokens: {}\n", active_count));
    output.push_str(&format!("Total Requests: {}\n", total_requests));
    output.push_str(&format!("Total Tokens Used: {}\n\n", total_tokens));

    // Request count bar chart
    if !token_data.is_empty() {
        output.push_str(&charts::render_bar_chart(
            &token_data,
            40,
            "Requests by Token",
        ));
    }

    Ok(output)
}

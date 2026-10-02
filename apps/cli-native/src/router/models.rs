//! Catalog reads reuse the frontend's token and safe routing-catalog APIs.
use super::config::RouterModels;
use crate::core::api::{ApiClient, AuthKind};
use anyhow::{Context, Result};
use reqwest::Method;
use serde_json::Value;
use std::collections::BTreeSet;

pub async fn token_details(api: &ApiClient, id: &str) -> Result<Value> {
    anyhow::ensure!(super::config::valid_id(id), "Invalid Relay Token ID");
    api.request(
        Method::GET,
        &format!("/v1/relay/tokens/{id}"),
        None,
        AuthKind::OAuth,
        false,
    )
    .await
    .map_err(|_| {
        anyhow::anyhow!("Cannot read Relay Token; check account credentials and token access")
    })
}
pub async fn fetch(api: &ApiClient, id: &str, details: &Value) -> Result<RouterModels> {
    anyhow::ensure!(super::config::valid_id(id), "Invalid Relay Token ID");
    let available: Value = api
        .request(
            Method::GET,
            &format!("/v1/relay/tokens/{id}/available-models"),
            None,
            AuthKind::OAuth,
            false,
        )
        .await
        .map_err(|_| anyhow::anyhow!("Cannot load this token's model catalog"))?;
    // New servers resolve all protocols, including nested compositions, themselves.
    if available["responses"].is_array() {
        return from_api(&available, &Value::Array(Vec::new()), details);
    }
    let catalog: Value = api
        .request(
            Method::GET,
            "/v1/relay-channels/routing-catalog",
            None,
            AuthKind::OAuth,
            false,
        )
        .await
        .map_err(|_| anyhow::anyhow!("Cannot load the authorized channel capability catalog"))?;
    from_api(&available, &catalog, details)
}
fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

pub fn from_api(available: &Value, catalog: &Value, token: &Value) -> Result<RouterModels> {
    let mut models = RouterModels {
        openai: strings(&available["openai"]),
        openai_responses: strings(&available["responses"]),
        anthropic: strings(&available["anthropic"]),
        gemini: strings(&available["gemini"]),
        ..Default::default()
    };
    if available["responses"].is_array() {
        normalize_catalogs(&mut models);
        return Ok(models);
    }
    let channels = catalog
        .as_array()
        .context("Invalid routing capability catalog")?;
    let selected: BTreeSet<&str> = token["channelConfigs"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| c["channelId"].as_str())
        .chain(token["channelId"].as_str())
        .chain(token["automaticProxyPoolChannelId"].as_str())
        .collect();
    let allowed: Vec<&str> = token["allowedModels"]
        .as_str()
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .collect();
    let mut responses = BTreeSet::new();
    for channel in channels.iter().filter(|c| {
        c["enabled"] == true && c["id"].as_str().is_some_and(|id| selected.contains(id))
    }) {
        for capability in channel["modelCapabilities"]
            .as_array()
            .into_iter()
            .flatten()
        {
            let Some(id) = capability["requestModelId"].as_str() else {
                continue;
            };
            if !strings(&capability["supportedRequestFormats"])
                .iter()
                .any(|f| f == "openai-responses")
            {
                continue;
            }
            let display = capability["catalogModelName"].as_str().unwrap_or(id);
            if !allowed.is_empty()
                && !allowed.iter().any(|rule| {
                    *rule == id
                        || *rule == display
                        || rule
                            .strip_suffix('*')
                            .is_some_and(|p| id.starts_with(p) || display.starts_with(p))
                })
            {
                continue;
            }
            responses.insert(id.to_string());
            for (alias, target) in token["modelMapping"].as_object().into_iter().flatten() {
                if !alias.contains('*')
                    && target
                        .as_str()
                        .is_some_and(|target| target == id || target == display)
                {
                    responses.insert(alias.clone());
                }
            }
        }
    }
    models.openai_responses = responses.into_iter().collect();
    // Translation is a token-scoped server capability. Use its target catalog
    // to describe the incoming protocol, rather than assuming model families.
    let original = models.clone();
    for transform in token["requestFormatTransforms"]
        .as_array()
        .into_iter()
        .flatten()
    {
        let target = match transform["targetFormat"].as_str() {
            Some("openai-chat-completions") => original.openai.clone(),
            Some("openai-responses") => original.openai_responses.clone(),
            Some("anthropic") => original.anthropic.clone(),
            _ => continue,
        };
        match transform["sourceFormat"].as_str() {
            Some("openai-chat-completions") => models.openai = target,
            Some("openai-responses") => models.openai_responses = target,
            Some("anthropic") => models.anthropic = target,
            _ => {}
        }
    }
    normalize_catalogs(&mut models);
    Ok(models)
}

fn normalize_catalogs(models: &mut RouterModels) {
    for list in [
        &mut models.openai,
        &mut models.openai_responses,
        &mut models.anthropic,
        &mut models.gemini,
    ] {
        list.sort();
        list.dedup();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn responses_are_not_inferred_from_chat_models() {
        let catalog = json!([{ "id":"channel", "enabled":true, "modelCapabilities":[{ "requestModelId":"responses-model", "supportedRequestFormats":["openai-responses"] }, {"requestModelId":"chat-only", "supportedRequestFormats":["openai-chat-completions"]}] }]);
        let token = json!({"channelConfigs":[{"channelId":"channel"}],"allowedModels":"responses-model", "modelMapping":{"alias":"responses-model"}});
        let models = from_api(&json!({"openai":["chat-only"]}), &catalog, &token).unwrap();
        assert_eq!(models.openai_responses, ["alias", "responses-model"]);
        assert!(!models.openai_responses.contains(&"chat-only".into()));
    }
    #[test]
    fn configured_translation_changes_input_capabilities() {
        let models = from_api(&json!({"anthropic":["real"]}), &json!([]), &json!({"requestFormatTransforms":[{"sourceFormat":"openai-responses","targetFormat":"anthropic"}]})).unwrap();
        assert_eq!(models.openai_responses, ["real"]);
    }
    #[test]
    fn composite_catalogs_are_server_authoritative_without_physical_channels() {
        let token = json!({"routingMode":"composite", "memberTokenConfigs":[{"tokenId":"member", "priority":0,"enabled":true}], "requestFormatTransforms":[{"sourceFormat":"openai-responses","targetFormat":"anthropic"}]});
        let models = from_api(&json!({"openai":["chat"], "responses":["codex-alias", "codex-alias"], "anthropic":["claude"], "gemini":[]}), &json!([]), &token).unwrap();
        assert_eq!(models.openai_responses, ["codex-alias"]);
        assert_eq!(models.anthropic, ["claude"]);
    }
    #[test]
    fn an_authoritative_empty_responses_catalog_never_infers_chat_models() {
        let models = from_api(
            &json!({"openai":["chat-only"], "responses":[], "anthropic":[], "gemini":[]}),
            &json!([]),
            &json!({"routingMode":"composite"}),
        )
        .unwrap();
        assert!(models.openai_responses.is_empty());
    }
}

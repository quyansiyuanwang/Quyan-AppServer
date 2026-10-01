//! Per-request selection without inventing a physical-channel override.
use super::config::{RouterConfig, RouterModels};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, clap::ValueEnum)]
pub enum Protocol {
    #[serde(rename = "openai")]
    Openai,
    #[serde(rename = "openai-responses")]
    OpenaiResponses,
    #[serde(rename = "anthropic")]
    Anthropic,
    #[serde(rename = "gemini")]
    Gemini,
}
impl Protocol {
    pub const ALL: [Self; 4] = [
        Self::Openai,
        Self::OpenaiResponses,
        Self::Anthropic,
        Self::Gemini,
    ];
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Openai => "openai",
            Self::OpenaiResponses => "openai-responses",
            Self::Anthropic => "anthropic",
            Self::Gemini => "gemini",
        }
    }
    pub fn models(self, models: &RouterModels) -> &[String] {
        match self {
            Self::Openai => &models.openai,
            Self::OpenaiResponses => &models.openai_responses,
            Self::Anthropic => &models.anthropic,
            Self::Gemini => &models.gemini,
        }
    }
}

pub fn stack_key(config: &RouterConfig, profile: &super::config::RouterProfile) -> String {
    let base = if profile.stack_key.is_empty() {
        super::config::slug_stack_key(&profile.name)
    } else {
        profile.stack_key.clone()
    };
    let mut key = if base.is_empty() {
        format!("p{}", &profile.id[..profile.id.len().min(6)])
    } else {
        base.clone()
    };
    let mut suffix = 2;
    let is_before = |other: &&super::config::RouterProfile| {
        other.id != profile.id
            && config
                .profiles
                .iter()
                .position(|item| item.id == other.id)
                .is_some_and(|index| {
                    config
                        .profiles
                        .iter()
                        .position(|item| item.id == profile.id)
                        .is_some_and(|profile_index| index < profile_index)
                })
    };
    while config
        .profiles
        .iter()
        .filter(is_before)
        .any(|other| stack_key_base(other) == key)
    {
        key = format!("{base}-{suffix}");
        suffix += 1;
    }
    key
}
fn stack_key_base(profile: &super::config::RouterProfile) -> String {
    if profile.stack_key.is_empty() {
        let value = super::config::slug_stack_key(&profile.name);
        if value.is_empty() {
            format!("p{}", &profile.id[..profile.id.len().min(6)])
        } else {
            value
        }
    } else {
        profile.stack_key.clone()
    }
}
pub fn stack_model_id(protocol: Protocol, key: &str, model: &str) -> String {
    match protocol {
        Protocol::Openai | Protocol::OpenaiResponses => format!("qys-{key}/{model}"),
        Protocol::Anthropic => format!("qys-claude-{key}--{model}"),
        Protocol::Gemini => format!("qys-gemini-{key}--{model}"),
    }
}
fn decode_stack_model(protocol: Protocol, model: &str) -> Option<(&str, &str)> {
    match protocol {
        Protocol::Openai | Protocol::OpenaiResponses => model
            .strip_prefix("qys-")?
            .split_once('/')
            .filter(|(key, upstream)| !key.is_empty() && !upstream.is_empty()),
        Protocol::Anthropic => model
            .strip_prefix("qys-claude-")?
            .split_once("--")
            .filter(|(key, upstream)| !key.is_empty() && !upstream.is_empty()),
        Protocol::Gemini => model
            .strip_prefix("qys-gemini-")?
            .split_once("--")
            .filter(|(key, upstream)| !key.is_empty() && !upstream.is_empty()),
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub profile_id: String,
    pub model: String,
}

pub fn candidates(config: &RouterConfig, protocol: Protocol, model: &str) -> Vec<Candidate> {
    if !config.active {
        return Vec::new();
    }
    if config.stack_enabled {
        if let Some((key, upstream)) = decode_stack_model(protocol, model) {
            for profile in config.profiles.iter().filter(|p| p.enabled) {
                if stack_key(config, profile) == key
                    && protocol
                        .models(&profile.models)
                        .iter()
                        .any(|candidate| candidate == upstream)
                {
                    return vec![Candidate {
                        profile_id: profile.id.clone(),
                        model: upstream.to_string(),
                    }];
                }
            }
            // A reserved Stack ID must never silently fall back to another profile.
            if model.starts_with("qys-") {
                return Vec::new();
            }
        }
    }
    let mut found = Vec::new();
    for profile in config.profiles.iter().filter(|p| p.enabled) {
        let rule = config
            .routes
            .iter()
            .filter(|r| {
                r.protocol == protocol
                    && r.profile_id == profile.id
                    && (r.model == model
                        || r.model
                            .strip_suffix('*')
                            .is_some_and(|prefix| model.starts_with(prefix)))
            })
            .min_by_key(|r| (if r.model == model { 0 } else { 1 }, r.priority));
        let target = rule
            .and_then(|r| r.upstream_model.as_deref())
            .unwrap_or(model);
        // A route never grants a capability absent from the authorized catalog.
        if !protocol.models(&profile.models).iter().any(|m| m == target) {
            continue;
        }
        let rank = rule.map_or(2, |r| if r.model == model { 0 } else { 1 });
        found.push((
            rank,
            rule.map_or(profile.priority, |r| r.priority),
            profile.priority,
            Candidate {
                profile_id: profile.id.clone(),
                model: target.into(),
            },
        ));
    }
    found.sort_by(|a, b| (a.0, a.1, a.2, &a.3.profile_id).cmp(&(b.0, b.1, b.2, &b.3.profile_id)));
    found.into_iter().map(|(_, _, _, c)| c).collect()
}
pub fn aggregate_models(config: &RouterConfig, protocol: Protocol) -> Vec<String> {
    if !config.active {
        return Vec::new();
    }
    let mut values: BTreeSet<String> = config
        .profiles
        .iter()
        .filter(|p| p.enabled)
        .flat_map(|p| protocol.models(&p.models).iter().cloned())
        .collect();
    if config.stack_enabled {
        for profile in config.profiles.iter().filter(|p| p.enabled) {
            let key = stack_key(config, profile);
            for model in protocol.models(&profile.models) {
                values.insert(stack_model_id(protocol, &key, model));
            }
        }
    }
    for route in config
        .routes
        .iter()
        .filter(|r| r.protocol == protocol && !r.model.contains('*'))
    {
        if !candidates(config, protocol, &route.model).is_empty() {
            values.insert(route.model.clone());
        }
    }
    values.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::router::config::{RouterProfile, RouterRoute};
    pub fn profile(id: &str, priority: i32, models: &[&str]) -> RouterProfile {
        RouterProfile {
            id: id.into(),
            name: id.into(),
            relay_token_id: id.into(),
            stack_key: String::new(),
            relay_base_url: "https://relay.example.test".into(),
            enabled: true,
            priority,
            models: RouterModels {
                openai: models.iter().map(|m| (*m).into()).collect(),
                openai_responses: models.iter().map(|m| (*m).into()).collect(),
                ..Default::default()
            },
            last_models_refresh_at: None,
        }
    }
    #[test]
    fn exact_prefix_auto_order_and_mapping() {
        let config = RouterConfig {
            profiles: vec![
                profile("auto", 0, &["gpt-x"]),
                profile("prefix", 0, &["real"]),
                profile("exact", 10, &["real"]),
            ],
            routes: vec![
                RouterRoute {
                    protocol: Protocol::Openai,
                    model: "gpt-*".into(),
                    profile_id: "prefix".into(),
                    upstream_model: Some("real".into()),
                    priority: 0,
                },
                RouterRoute {
                    protocol: Protocol::Openai,
                    model: "gpt-x".into(),
                    profile_id: "exact".into(),
                    upstream_model: Some("real".into()),
                    priority: 99,
                },
            ],
            ..Default::default()
        };
        let mut config = config;
        for profile in &mut config.profiles {
            profile.models.openai_responses.clear();
        }
        let found = candidates(&config, Protocol::Openai, "gpt-x");
        assert_eq!(
            found
                .iter()
                .map(|c| c.profile_id.as_str())
                .collect::<Vec<_>>(),
            ["exact", "prefix", "auto"]
        );
        assert_eq!(found[0].model, "real");
        assert!(candidates(&config, Protocol::Anthropic, "gpt-x").is_empty());
        assert!(candidates(&config, Protocol::OpenaiResponses, "gpt-x").is_empty());
    }
    #[test]
    fn disabled_unknown_and_unavailable_aliases_fail_closed() {
        let mut config = RouterConfig {
            profiles: vec![profile("one", 0, &["m"]), profile("two", 1, &["m"])],
            ..Default::default()
        };
        assert_eq!(aggregate_models(&config, Protocol::Openai), ["m"]);
        config.profiles[0].enabled = false;
        assert_eq!(
            candidates(&config, Protocol::Openai, "m")[0].profile_id,
            "two"
        );
        assert!(candidates(&config, Protocol::Openai, "unknown").is_empty());
        config.active = false;
        assert!(aggregate_models(&config, Protocol::Openai).is_empty());
    }
    #[test]
    fn stack_models_bind_to_exact_profile_without_fallback() {
        let mut config = RouterConfig {
            stack_enabled: true,
            profiles: vec![profile("one", 0, &["model"]), profile("two", 1, &["model"])],
            ..Default::default()
        };
        config.profiles[0].stack_key = "primary".into();
        config.profiles[1].stack_key = "backup".into();
        let id = stack_model_id(Protocol::OpenaiResponses, "backup", "model");
        let found = candidates(&config, Protocol::OpenaiResponses, &id);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].profile_id, "two");
        assert_eq!(found[0].model, "model");
        assert!(candidates(&config, Protocol::OpenaiResponses, "qys-primary--broken").is_empty());
        assert!(aggregate_models(&config, Protocol::OpenaiResponses).contains(&id));
        let keys = config
            .profiles
            .iter()
            .map(|profile| stack_key(&config, profile))
            .collect::<Vec<_>>();
        assert_eq!(keys, ["primary", "backup"]);
    }
}

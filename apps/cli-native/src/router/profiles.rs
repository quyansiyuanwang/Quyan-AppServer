//! Relay secrets are isolated by profile; only account reads use account credentials.
use super::{
    config::{self, RouterProfile},
    models,
};
use crate::core::{api::ApiClient, credentials};
use anyhow::{ensure, Context, Result};
use keyring::Entry;
use std::sync::Arc;

pub trait ProfileSecrets: Send + Sync {
    fn get(&self, id: &str) -> Result<String>;
    fn set(&self, id: &str, secret: &str) -> Result<()>;
    fn remove(&self, id: &str) -> Result<()>;
}
#[derive(Default)]
pub struct KeyringSecrets;
impl ProfileSecrets for KeyringSecrets {
    fn get(&self, id: &str) -> Result<String> {
        let value = Entry::new("quyan-router-profile", id)?
            .get_password()
            .context("Router profile credential unavailable in system keychain")?;
        ensure!(
            credentials::classify(&value) == "relay-token",
            "Invalid router profile credential type"
        );
        Ok(value)
    }
    fn set(&self, id: &str, secret: &str) -> Result<()> {
        ensure!(
            config::valid_id(id) && credentials::classify(secret) == "relay-token",
            "Invalid router credential"
        );
        Entry::new("quyan-router-profile", id)?
            .set_password(secret)
            .context("Cannot save profile credential in system keychain")
    }
    fn remove(&self, id: &str) -> Result<()> {
        match Entry::new("quyan-router-profile", id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => anyhow::bail!("Cannot remove profile credential from system keychain"),
        }
    }
}
pub fn secrets() -> Arc<dyn ProfileSecrets> {
    Arc::new(KeyringSecrets)
}

pub async fn add(
    api: &ApiClient,
    token_id: &str,
    name: Option<&str>,
    priority: i32,
) -> Result<RouterProfile> {
    let details = models::token_details(api, token_id).await?;
    let selected = super::models::fetch(api, token_id, &details).await?;
    let secret = details["token"]
        .as_str()
        .filter(|v| credentials::classify(v) == "relay-token")
        .context("Token did not contain a Relay credential")?;
    ensure!(
        details["status"].as_i64() == Some(1),
        "Selected Relay Token is disabled"
    );
    if let Some(expiry) = details["expiresAt"].as_str() {
        ensure!(
            chrono::DateTime::parse_from_rfc3339(expiry)? > chrono::Utc::now(),
            "Selected Relay Token expired"
        );
    }
    let id = uuid::Uuid::new_v4().to_string();
    let profile = RouterProfile {
        id: id.clone(),
        name: name.or(details["name"].as_str()).unwrap_or(token_id).into(),
        relay_token_id: token_id.into(),
        relay_base_url: api.relay_base_url.clone(),
        enabled: true,
        priority,
        models: selected,
        last_models_refresh_at: Some(chrono::Utc::now().to_rfc3339()),
    };
    let store = KeyringSecrets;
    store.set(&id, secret)?;
    let result = config::update(|c| {
        c.profiles.push(profile.clone());
        Ok(())
    });
    if result.is_err() {
        let _ = store.remove(&id);
    }
    result?;
    Ok(profile)
}
pub fn remove(id: &str) -> Result<()> {
    config::update(|c| {
        ensure!(
            c.profiles.iter().any(|p| p.id == id),
            "Unknown router profile"
        );
        c.profiles.retain(|p| p.id != id);
        c.routes.retain(|r| r.profile_id != id);
        Ok(())
    })?;
    KeyringSecrets.remove(id)
}
pub async fn refresh(api: &ApiClient) -> Result<()> {
    let config = config::load()?;
    let mut refreshed = Vec::new();
    for profile in &config.profiles {
        let details = models::token_details(api, &profile.relay_token_id).await?;
        // Never rotate credentials silently: rotation is an explicit remove/add.
        let fetched = models::fetch(api, &profile.relay_token_id, &details).await?;
        refreshed.push((profile.id.clone(), fetched));
    }
    config::update(|c| {
        for (id, models) in refreshed {
            if let Some(p) = c.profiles.iter_mut().find(|p| p.id == id) {
                p.models = models;
                p.last_models_refresh_at = Some(chrono::Utc::now().to_rfc3339());
            }
        }
        Ok(())
    })
}

#[cfg(test)]
pub(crate) mod fixtures {
    use super::*;
    use std::{collections::HashMap, sync::Mutex};
    #[derive(Default)]
    #[allow(dead_code)]
    pub struct MemorySecrets(pub Mutex<HashMap<String, String>>);
    impl ProfileSecrets for MemorySecrets {
        fn get(&self, id: &str) -> Result<String> {
            self.0
                .lock()
                .unwrap()
                .get(id)
                .cloned()
                .context("Fixture secret not found")
        }
        fn set(&self, id: &str, secret: &str) -> Result<()> {
            self.0.lock().unwrap().insert(id.into(), secret.into());
            Ok(())
        }
        fn remove(&self, id: &str) -> Result<()> {
            self.0.lock().unwrap().remove(id);
            Ok(())
        }
    }
}

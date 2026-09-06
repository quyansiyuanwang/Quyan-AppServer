use anyhow::{Context, Result};
use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "quyan";
const USERNAME: &str = "default";

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Credentials {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub access_key: Option<String>,
    pub relay_token: Option<String>,
    pub product_key: Option<String>,
    pub replay_session_id: Option<String>,
    pub replay_signing_key: Option<String>,
}

pub fn load() -> Result<Credentials> {
    let entry = Entry::new(SERVICE, USERNAME).context("failed to open system keyring")?;
    match entry.get_password() {
        Ok(value) => Ok(serde_json::from_str(&value).context("invalid Quyan credentials")?),
        Err(keyring::Error::NoEntry) => Ok(Credentials::default()),
        Err(error) => Err(error).context("failed to read Quyan credentials"),
    }
}

pub fn save(credentials: &Credentials) -> Result<()> {
    let entry = Entry::new(SERVICE, USERNAME).context("failed to open system keyring")?;
    entry
        .set_password(&serde_json::to_string(credentials)?)
        .context("failed to save Quyan credentials")
}

pub fn clear() -> Result<()> {
    let entry = Entry::new(SERVICE, USERNAME).context("failed to open system keyring")?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error).context("failed to clear Quyan credentials"),
    }
}

pub fn classify(value: &str) -> &'static str {
    if value.starts_with("ak_") {
        "access-key"
    } else if value.starts_with("rlt_") {
        "relay-token"
    } else if value.starts_with("dpk_") {
        "product-key"
    } else {
        "unknown"
    }
}

pub fn mask(value: &str) -> String {
    if value.len() <= 8 {
        return "********".into();
    }
    format!(
        "{}...{}",
        &value[..value.len().min(7)],
        &value[value.len() - 4..]
    )
}

#[cfg(test)]
mod tests {
    use super::{classify, mask};

    #[test]
    fn classifies_credential_boundaries() {
        assert_eq!(classify("ak_test"), "access-key");
        assert_eq!(classify("rlt_test"), "relay-token");
        assert_eq!(classify("dpk_test"), "product-key");
        assert_eq!(classify("secret"), "unknown");
    }

    #[test]
    fn masks_secrets() {
        assert_eq!(mask("rlt_1234567890"), "rlt_123...7890");
        assert_eq!(mask("short"), "********");
    }
}

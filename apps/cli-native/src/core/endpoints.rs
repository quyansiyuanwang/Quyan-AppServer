use anyhow::{ensure, Context, Result};
use url::Url;

/// Outbound credential-bearing endpoints must use TLS, except local development.
pub fn validate_endpoint(value: &str) -> Result<Url> {
    let url = Url::parse(value).context("Invalid endpoint URL")?;
    ensure!(
        url.scheme() == "https"
            || (url.scheme() == "http"
                && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))),
        "Use HTTPS, except for loopback development"
    );
    ensure!(
        url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none(),
        "Endpoint URL cannot contain credentials, query or fragment"
    );
    Ok(url)
}

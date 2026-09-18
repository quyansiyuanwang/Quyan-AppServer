use anyhow::Result;
use reqwest::Method;
use serde_json::Value;

use crate::core::api::{ApiClient, AuthKind};

mod routes {
    include!(concat!(env!("OUT_DIR"), "/account_routes.rs"));
}

pub async fn profile(api: &ApiClient) -> Result<Value> {
    api.request(Method::GET, routes::PROFILE, None, AuthKind::OAuth, false)
        .await
}
pub async fn balance(api: &ApiClient) -> Result<Value> {
    api.request(Method::GET, routes::BALANCE, None, AuthKind::OAuth, false)
        .await
}
pub async fn usage(api: &ApiClient) -> Result<Value> {
    api.request(Method::GET, routes::USAGE, None, AuthKind::OAuth, false)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::credentials::Credentials;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    #[tokio::test]
    async fn overview_calls_real_get_contracts_with_oauth() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            for path in [routes::PROFILE, routes::BALANCE, routes::USAGE] {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut buffer = [0u8; 8192];
                let size = stream.read(&mut buffer).await.unwrap();
                let request = String::from_utf8_lossy(&buffer[..size]);
                assert!(request.starts_with(&format!("GET {path} HTTP/1.1")));
                assert!(request
                    .to_lowercase()
                    .contains("authorization: bearer test-access"));
                let body = r#"{"code":0,"message":"OK","data":{"ok":true}}"#;
                stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            }
        });
        let api = ApiClient::with_endpoints(
            Credentials {
                access_token: Some("test-access".into()),
                ..Default::default()
            },
            "en-US",
            &base,
            &base,
        )
        .unwrap();
        assert_eq!(profile(&api).await.unwrap()["ok"], true);
        assert_eq!(balance(&api).await.unwrap()["ok"], true);
        assert_eq!(usage(&api).await.unwrap()["ok"], true);
        server.await.unwrap();
    }
}

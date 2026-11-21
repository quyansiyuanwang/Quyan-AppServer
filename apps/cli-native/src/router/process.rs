//! Instance-checked loopback process control. Runtime metadata contains no secrets.
use super::{config, policy, profiles, proxy};
use anyhow::{ensure, Context, Result};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, io::Write, path::PathBuf, sync::Arc, time::Instant};

#[cfg(windows)]
mod windows;

#[cfg(not(windows))]
fn spawn() -> Result<std::process::Child> {
    use std::process::Stdio;
    Ok(std::process::Command::new(std::env::current_exe()?)
        .args(["router", "serve"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .context("Cannot start Router")?)
}
#[cfg(windows)]
use windows::spawn;

const CONTROL_SERVICE: &str = "quyan-router-control";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    pid: u32,
    instance_id: String,
    base_url: String,
}
fn path() -> PathBuf {
    crate::core::config::directory().join("router-runtime.json")
}
fn lock(name: &str) -> Result<fs::File> {
    let directory = crate::core::config::directory();
    fs::create_dir_all(&directory)?;
    Ok(fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join(name))?)
}
fn record() -> Result<Option<Record>> {
    let Some(text) = crate::features::integrations::files::read(&path())? else {
        return Ok(None);
    };
    let record: Record = serde_json::from_str(&text).context("Invalid Router runtime record")?;
    validate_record(&record)?;
    Ok(Some(record))
}
fn validate_record(record: &Record) -> Result<()> {
    ensure!(
        uuid::Uuid::parse_str(&record.instance_id).is_ok() && record.pid > 0,
        "Invalid Router instance"
    );
    let url = url::Url::parse(&record.base_url)?;
    ensure!(
        url.scheme() == "http"
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
            && url.path() == "/"
            && url.port().is_some_and(|port| port >= 1024)
            && match url.host() {
                Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
                Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
                _ => false,
            },
        "Invalid Router control address"
    );
    Ok(())
}
fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(policy::CONTROL_TIMEOUT)
        .build()?)
}
async fn checked_status(record: &Record) -> Result<Value> {
    // Check public identity before sending the private control nonce.
    let client = client()?;
    let health: Value = client
        .get(format!("{}/health", record.base_url))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    ensure!(
        health["service"] == "quyan-router" && health["instanceId"] == record.instance_id,
        "Router instance changed"
    );
    let secret = keyring::Entry::new(CONTROL_SERVICE, &record.instance_id)?
        .get_password()
        .context("Router control credential unavailable")?;
    let value: Value = client
        .get(format!("{}/_quyan/status", record.base_url))
        .header("x-quyan-control", secret)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    ensure!(
        value["instanceId"] == record.instance_id && value["pid"] == record.pid,
        "Router identity mismatch"
    );
    Ok(value)
}
pub async fn status() -> Result<Value> {
    match record()? {
        None => Ok(json!({"running":false})),
        Some(record) => match checked_status(&record).await {
            Ok(value) => Ok(value),
            Err(_) => Ok(json!({"running":false,"stale":true,"baseUrl":record.base_url})),
        },
    }
}
pub async fn start() -> Result<Value> {
    let start_lock = lock("router-start.lock")?;
    start_lock
        .try_lock_exclusive()
        .context("Router is starting; retry shortly")?;
    if let Some(record) = record()? {
        if let Ok(value) = checked_status(&record).await {
            return Ok(value);
        }
    }
    config::load()?.validate()?;
    let mut child = spawn()?;
    let started = Instant::now();
    while started.elapsed() < policy::START_TIMEOUT {
        if let Some(record) = record()? {
            if record.pid == child.id() {
                if let Ok(value) = checked_status(&record).await {
                    std::thread::spawn(move || {
                        let _ = child.wait();
                    });
                    return Ok(value);
                }
            }
        }
        if child.try_wait()?.is_some() {
            anyhow::bail!("Router could not start; inspect diagnostics");
        }
        tokio::time::sleep(policy::POLL_INTERVAL).await;
    }
    anyhow::bail!("Router startup timed out; check router status before retrying")
}
async fn control(record: &Record, action: &str) -> Result<Value> {
    checked_status(record).await?;
    let secret = keyring::Entry::new(CONTROL_SERVICE, &record.instance_id)?.get_password()?;
    Ok(client()?
        .post(format!("{}/_quyan/{action}", record.base_url))
        .header("x-quyan-control", secret)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?)
}
pub async fn reload() -> Result<Value> {
    let record = record()?.context("Router is stopped")?;
    control(&record, "reload").await
}
pub async fn reload_if_running() -> Result<()> {
    if let Some(record) = record()? {
        if checked_status(&record).await.is_ok() {
            control(&record, "reload").await?;
        }
    }
    Ok(())
}
pub async fn stop() -> Result<Value> {
    let Some(original) = record()? else {
        return Ok(json!({"stopped":true}));
    };
    control(&original, "stop").await?;
    let started = Instant::now();
    while started.elapsed() < policy::STOP_TIMEOUT {
        match record()? {
            None => return Ok(json!({"stopped":true})),
            Some(current) if current.instance_id != original.instance_id => {
                return Ok(json!({"stopped":true}))
            }
            _ => {}
        }
        tokio::time::sleep(policy::POLL_INTERVAL).await;
    }
    anyhow::bail!("Router stop is still pending")
}
struct Cleanup(Record);
impl Drop for Cleanup {
    fn drop(&mut self) {
        if let Ok(entry) = keyring::Entry::new(CONTROL_SERVICE, &self.0.instance_id) {
            let _ = entry.delete_credential();
        }
        if record()
            .ok()
            .flatten()
            .is_some_and(|current| current.instance_id == self.0.instance_id)
        {
            let _ = fs::remove_file(path());
        }
    }
}
pub async fn serve() -> Result<()> {
    let service_lock = lock("router-service.lock")?;
    service_lock
        .try_lock_exclusive()
        .context("Router is already running")?;
    let config = config::load()?;
    let listener = tokio::net::TcpListener::bind(config.address())
        .await
        .context("Router port unavailable")?;
    // The service lock and bound port prove an old cooperating instance is gone.
    if let Ok(Some(previous)) = record() {
        if let Ok(entry) = keyring::Entry::new(CONTROL_SERVICE, &previous.instance_id) {
            let _ = entry.delete_credential();
        }
    }
    let instance = uuid::Uuid::new_v4().to_string();
    let secret = format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
    let runtime = proxy::Runtime::new(
        config::path(),
        profiles::secrets(),
        instance.clone(),
        secret.clone(),
    )?;
    keyring::Entry::new(CONTROL_SERVICE, &instance)?.set_password(&secret)?;
    let record = Record {
        pid: std::process::id(),
        instance_id: instance,
        base_url: config.base_url(),
    };
    let _cleanup = Cleanup(record.clone());
    let mut file = tempfile::NamedTempFile::new_in(crate::core::config::directory())?;
    file.write_all(serde_json::to_string(&record)?.as_bytes())?;
    file.as_file().sync_all()?;
    file.persist(path())?;
    let mut shutdown = runtime.shutdown.subscribe();
    let mut finishing = runtime.shutdown.subscribe();
    let shutdown_runtime = Arc::clone(&runtime);
    let server = axum::serve(listener, proxy::app(runtime)).with_graceful_shutdown(async move {
        tokio::select! { _ = shutdown.changed() => {}, _ = tokio::signal::ctrl_c() => {} }
        let _ = shutdown_runtime.shutdown.send(true);
    });
    // Bound graceful shutdown even if a client leaves a stream open.
    let mut completion = Box::pin(std::future::IntoFuture::into_future(server));
    tokio::select! {
        result = &mut completion => { result?; },
        _ = finishing.changed() => {
            let _ = tokio::time::timeout(policy::SHUTDOWN_GRACE, completion).await;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn runtime_record_rejects_remote_addresses_and_secret_fields() {
        let mut record = Record {
            pid: 1,
            instance_id: uuid::Uuid::new_v4().to_string(),
            base_url: "http://127.0.0.1:15721".into(),
        };
        assert!(validate_record(&record).is_ok());
        for address in [
            "http://example.test:15721",
            "http://127.0.0.1:15721/other",
            "https://127.0.0.1:15721",
            "http://127.0.0.1:15721?key=x",
        ] {
            record.base_url = address.into();
            assert!(validate_record(&record).is_err());
        }
        assert!(!serde_json::to_string(&record)
            .unwrap()
            .contains("controlToken"));
    }
}

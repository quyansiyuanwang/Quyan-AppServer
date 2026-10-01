//! Opt-in lifecycle smoke: isolated config and empty profiles, no Relay traffic.
//! A short-lived OS keychain control entry is created and deleted by the service.
use serde_json::{json, Value};
use std::{fs, net::TcpListener, path::Path, process::Command};

fn command(directory: &Path, args: &[&str]) -> std::process::Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_quyan"));
    command.env("QUYAN_CONFIG_DIR", directory).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.output().expect("start isolated CLI")
}
fn successful(directory: &Path, args: &[&str]) -> Value {
    let output = command(directory, args);
    assert!(
        output.status.success(),
        "CLI failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("JSON-only stdout")
}
struct Cleanup<'a>(&'a Path);
impl Drop for Cleanup<'_> {
    fn drop(&mut self) {
        let _ = command(self.0, &["--json", "router", "stop", "--yes"]);
    }
}

#[test]
#[ignore = "requires an interactive OS keychain; run explicitly for native lifecycle verification"]
fn native_router_start_duplicate_reload_and_stop_preserve_process_identity() {
    let dir = tempfile::tempdir().unwrap();
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let config = json!({"version":1,"listenAddress":"127.0.0.1","listenPort":port,"active":true,"profiles":[],"routes":[]});
    let path = dir.path().join("router.json");
    fs::write(&path, config.to_string()).unwrap();
    let _cleanup = Cleanup(dir.path());
    let started = successful(dir.path(), &["--json", "router", "start", "--yes"]);
    assert_eq!(started["running"], true);
    let instance = started["instanceId"].as_str().unwrap().to_owned();
    let pid = started["pid"].clone();
    let duplicate = successful(dir.path(), &["--json", "router", "start", "--yes"]);
    assert_eq!(duplicate["instanceId"], instance);
    assert_eq!(duplicate["pid"], pid);
    fs::write(&path, "invalid fixture configuration").unwrap();
    assert!(
        !command(dir.path(), &["--json", "router", "reload", "--yes"])
            .status
            .success()
    );
    assert_eq!(
        successful(dir.path(), &["--json", "router", "status"])["pid"],
        pid
    );
    fs::write(&path, config.to_string()).unwrap();
    assert_eq!(
        successful(dir.path(), &["--json", "router", "reload", "--yes"])["reloaded"],
        true
    );
    assert_eq!(
        successful(dir.path(), &["--json", "router", "stop", "--yes"])["stopped"],
        true
    );
    assert_eq!(
        successful(dir.path(), &["--json", "router", "status"])["running"],
        false
    );
    assert!(!dir.path().join("router-runtime.json").exists());
    assert!(matches!(
        keyring::Entry::new("quyan-router-control", &instance)
            .unwrap()
            .get_password(),
        Err(keyring::Error::NoEntry)
    ));
}

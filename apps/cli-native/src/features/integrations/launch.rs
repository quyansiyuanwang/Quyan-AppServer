use super::{endpoint, ClientKind, PROVIDER_ID, RELAY_KEY_ENV};
use crate::core::credentials::{classify, Credentials};
use anyhow::{ensure, Context, Result};
use std::{ffi::OsString, process::Command};

fn command(
    kind: ClientKind,
    creds: &Credentials,
    base: &str,
    model: Option<&str>,
    args: &[OsString],
) -> Result<Command> {
    let key = creds
        .relay_token
        .as_deref()
        .filter(|key| classify(key) == "relay-token")
        .context("Select a Relay Token in AI Relay (u), or import an rlt_ credential first")?;
    let (program, args) = match kind.executable() {
        Some(program) => (OsString::from(program), args),
        None => (
            args.first()
                .context("Specify the harness executable after --")?
                .clone(),
            &args[1..],
        ),
    };
    let mut command = Command::new(resolve_program(&program));
    match kind {
        ClientKind::ClaudeCode | ClientKind::Anthropic => {
            command
                .env("ANTHROPIC_BASE_URL", endpoint(base, false)?)
                .env("ANTHROPIC_AUTH_TOKEN", key)
                .env_remove("ANTHROPIC_API_KEY")
                .env_remove("CLAUDE_CODE_OAUTH_TOKEN");
            if let Some(model) = model {
                command.env("ANTHROPIC_MODEL", model);
            }
        }
        ClientKind::Codex => {
            command.env(RELAY_KEY_ENV, key);
            // Runtime overrides ensure the selected relay wins, even without applying config.
            command.arg("-c").arg(format!(
                "model_provider={}",
                serde_json::to_string(PROVIDER_ID)?
            ));
            let base = endpoint(base, true)?;
            for (key, value) in super::codex_provider(&base) {
                command.arg("-c").arg(format!(
                    "model_providers.{PROVIDER_ID}.{key}={}",
                    serde_json::to_string(value)?
                ));
            }
            if let Some(model) = model {
                command.arg("--model").arg(model);
            }
        }
        ClientKind::Pi => {
            command
                .env(RELAY_KEY_ENV, key)
                .arg("--provider")
                .arg(PROVIDER_ID);
            if let Some(model) = model {
                command.arg("--model").arg(model);
            }
        }
        ClientKind::Openai => {
            command
                .env("OPENAI_API_KEY", key)
                .env("OPENAI_BASE_URL", endpoint(base, true)?);
            if let Some(model) = model {
                command.env("OPENAI_MODEL", model);
            }
        }
    }
    command.args(args);
    Ok(command)
}

// npm tools may only expose a .cmd launcher on Windows. Resolve it without
// constructing a shell command; std::process handles argument escaping.
fn resolve_program(program: &std::ffi::OsStr) -> OsString {
    #[cfg(windows)]
    if let Some(path) = std::env::var_os("PATH") {
        if let Some(found) = resolve_windows_launcher(program, &path) {
            return found.into_os_string();
        }
    }
    program.to_owned()
}

#[cfg(windows)]
fn resolve_windows_launcher(
    program: &std::ffi::OsStr,
    search_path: &std::ffi::OsStr,
) -> Option<std::path::PathBuf> {
    use std::path::Path;
    let program = Path::new(program);
    if program.extension().is_some() {
        return None;
    }
    let candidates = if program.components().count() > 1 {
        vec![program.to_path_buf()]
    } else {
        std::env::split_paths(search_path)
            .filter(|dir| !dir.as_os_str().is_empty())
            .map(|dir| dir.join(program))
            .collect()
    };
    for candidate in candidates {
        for extension in ["exe", "com", "cmd", "bat"] {
            let file = candidate.with_extension(extension);
            if file.is_file() {
                return Some(file);
            }
        }
    }
    None
}

pub fn launch(
    kind: ClientKind,
    creds: &Credentials,
    base: &str,
    model: Option<&str>,
    args: &[OsString],
) -> Result<()> {
    let status = command(kind, creds, base, model, args)?
        .status()
        .context("Could not launch client. Install it and check PATH first")?;
    ensure!(status.success(), "Client exited unsuccessfully ({status})");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    #[test]
    fn resolves_npm_cmd_launchers_without_a_shell_string() {
        let dir = tempfile::tempdir().unwrap();
        let launcher = dir.path().join("test-tool.cmd");
        std::fs::write(&launcher, "@echo off\r\nexit /b 0\r\n").unwrap();
        let search_path = std::env::join_paths([dir.path()]).unwrap();
        let resolved =
            resolve_windows_launcher(std::ffi::OsStr::new("test-tool"), &search_path).unwrap();
        assert_eq!(resolved, launcher);
        assert!(std::process::Command::new(resolved)
            .arg("--help")
            .status()
            .unwrap()
            .success());
    }

    #[test]
    fn secrets_are_only_in_child_environment_not_arguments() {
        let creds = Credentials {
            relay_token: Some("rlt_test_only".into()),
            ..Default::default()
        };
        let command = command(ClientKind::Codex, &creds, "https://relay.test", None, &[]).unwrap();
        assert!(command
            .get_args()
            .all(|arg| !arg.to_string_lossy().contains("rlt_test_only")));
        assert!(command.get_envs().any(|(key, value)| key == RELAY_KEY_ENV
            && value == Some(std::ffi::OsStr::new("rlt_test_only"))));
    }
    #[test]
    fn account_credentials_never_substitute_for_relay_keys() {
        let creds = Credentials {
            access_token: Some("account-test".into()),
            ..Default::default()
        };
        assert!(command(ClientKind::Codex, &creds, "https://relay.test", None, &[]).is_err());
    }
    #[test]
    fn generic_harness_receives_explicit_protocol_environment() {
        let creds = Credentials {
            relay_token: Some("rlt_test_only".into()),
            ..Default::default()
        };
        let command = command(
            ClientKind::Openai,
            &creds,
            "https://relay.test",
            None,
            &["test-harness".into(), "--help".into()],
        )
        .unwrap();
        assert_eq!(command.get_program(), "test-harness");
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            vec![std::ffi::OsStr::new("--help")]
        );
        assert!(command
            .get_envs()
            .any(|(key, value)| key == "OPENAI_BASE_URL"
                && value == Some(std::ffi::OsStr::new("https://relay.test/v1"))));
    }
}

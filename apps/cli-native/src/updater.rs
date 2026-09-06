use anyhow::{Context, Result};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::{
    env,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

const UPDATE_CHECK_INTERVAL_HOURS: u64 = 24;
const GITHUB_API_RELEASES: &str =
    "https://api.github.com/repos/quyansiyuanwang/Quyan-AppServer/releases/latest";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub download_url: String,
    pub release_notes: String,
    pub published_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct UpdateCheckCache {
    last_check: SystemTime,
    latest_version: Option<String>,
    download_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    body: String,
    published_at: String,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

pub async fn check_for_updates(force: bool) -> Result<Option<UpdateInfo>> {
    let current = Version::parse(env!("CARGO_PKG_VERSION"))
        .context("failed to parse current version")?;

    if !force {
        if let Some(cached) = load_cache()? {
            let elapsed = SystemTime::now()
                .duration_since(cached.last_check)
                .unwrap_or(Duration::MAX);
            if elapsed < Duration::from_secs(UPDATE_CHECK_INTERVAL_HOURS * 3600) {
                if let Some(latest_version) = cached.latest_version {
                    let latest = Version::parse(&latest_version)?;
                    if latest > current {
                        return Ok(Some(UpdateInfo {
                            current_version: current.to_string(),
                            latest_version: latest_version.clone(),
                            download_url: cached.download_url.unwrap_or_default(),
                            release_notes: String::new(),
                            published_at: String::new(),
                        }));
                    }
                }
                return Ok(None);
            }
        }
    }

    tracing::debug!("checking for updates from GitHub");
    let client = reqwest::Client::builder()
        .user_agent(format!("quyan-cli/{}", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(10))
        .build()?;

    let response = client
        .get(GITHUB_API_RELEASES)
        .send()
        .await
        .context("failed to fetch latest release")?;

    if !response.status().is_success() {
        tracing::warn!(status = %response.status(), "GitHub API request failed");
        return Ok(None);
    }

    let release: GitHubRelease = response
        .json()
        .await
        .context("failed to parse GitHub release")?;

    let version_str = release.tag_name.trim_start_matches('v');
    let latest = Version::parse(version_str).context("failed to parse latest version")?;

    let download_url = get_platform_asset_url(&release.assets)?;

    save_cache(&UpdateCheckCache {
        last_check: SystemTime::now(),
        latest_version: Some(latest.to_string()),
        download_url: Some(download_url.clone()),
    })?;

    if latest > current {
        tracing::info!(
            current = %current,
            latest = %latest,
            "new version available"
        );
        Ok(Some(UpdateInfo {
            current_version: current.to_string(),
            latest_version: latest.to_string(),
            download_url,
            release_notes: release.body,
            published_at: release.published_at,
        }))
    } else {
        tracing::debug!(current = %current, latest = %latest, "up to date");
        Ok(None)
    }
}

fn get_platform_asset_url(assets: &[GitHubAsset]) -> Result<String> {
    let platform = env::consts::OS;
    let arch = env::consts::ARCH;

    let pattern = match (platform, arch) {
        ("windows", "x86_64") => "quyan-x86_64-pc-windows-msvc.exe",
        ("linux", "x86_64") => "quyan-x86_64-unknown-linux-gnu",
        ("macos", "x86_64") => "quyan-x86_64-apple-darwin",
        ("macos", "aarch64") => "quyan-aarch64-apple-darwin",
        _ => anyhow::bail!("unsupported platform: {platform}-{arch}"),
    };

    assets
        .iter()
        .find(|asset| asset.name == pattern)
        .map(|asset| asset.browser_download_url.clone())
        .with_context(|| format!("no binary found for platform: {platform}-{arch}"))
}

pub async fn download_and_install_update(update_info: &UpdateInfo) -> Result<()> {
    tracing::info!(
        version = %update_info.latest_version,
        url = %update_info.download_url,
        "downloading update"
    );

    let client = reqwest::Client::builder()
        .user_agent(format!("quyan-cli/{}", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(300))
        .build()?;

    let response = client
        .get(&update_info.download_url)
        .send()
        .await
        .context("failed to download update")?;

    if !response.status().is_success() {
        anyhow::bail!("download failed with status: {}", response.status());
    }

    let bytes = response
        .bytes()
        .await
        .context("failed to read download response")?;

    let current_exe = env::current_exe().context("failed to get current executable path")?;
    let backup_path = current_exe.with_extension("backup");

    tracing::debug!(
        current = %current_exe.display(),
        backup = %backup_path.display(),
        "backing up current executable"
    );

    if backup_path.exists() {
        fs::remove_file(&backup_path).context("failed to remove old backup")?;
    }

    fs::copy(&current_exe, &backup_path).context("failed to backup current executable")?;

    let temp_dir = tempfile::tempdir().context("failed to create temp directory")?;
    let temp_file = temp_dir.path().join("quyan-new");

    tracing::debug!(temp = %temp_file.display(), "writing new binary to temp file");

    let mut file = File::create(&temp_file).context("failed to create temp file")?;
    file.write_all(&bytes)
        .context("failed to write new binary")?;
    file.sync_all().context("failed to sync new binary to disk")?;
    drop(file);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&temp_file)?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&temp_file, perms)?;
    }

    tracing::debug!(
        from = %temp_file.display(),
        to = %current_exe.display(),
        "replacing current executable"
    );

    replace_executable(&temp_file, &current_exe)?;

    tracing::info!("update installed successfully");

    println!(
        "\nUpdate installed successfully!\nVersion: {} → {}\n",
        update_info.current_version, update_info.latest_version
    );

    if !update_info.release_notes.is_empty() {
        println!("Release notes:\n{}\n", update_info.release_notes);
    }

    Ok(())
}

#[cfg(windows)]
fn replace_executable(temp_file: &Path, target: &Path) -> Result<()> {
    use std::process::Command;

    let temp_script = target.with_extension("update.bat");
    let script_content = format!(
        r#"@echo off
timeout /t 1 /nobreak >nul
move /y "{}" "{}"
del "%~f0"
"#,
        temp_file.display(),
        target.display()
    );

    fs::write(&temp_script, script_content).context("failed to write update script")?;

    Command::new("cmd")
        .args(["/C", "start", "/B", temp_script.to_str().unwrap()])
        .spawn()
        .context("failed to spawn update script")?;

    Ok(())
}

#[cfg(not(windows))]
fn replace_executable(temp_file: &Path, target: &Path) -> Result<()> {
    fs::rename(temp_file, target).context("failed to replace executable")?;
    Ok(())
}

fn cache_file_path() -> PathBuf {
    crate::config::directory().join("update_check.json")
}

fn load_cache() -> Result<Option<UpdateCheckCache>> {
    let path = cache_file_path();
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read(&path).context("failed to read update cache")?;
    let cache: UpdateCheckCache = serde_json::from_slice(&contents)?;
    Ok(Some(cache))
}

fn save_cache(cache: &UpdateCheckCache) -> Result<()> {
    fs::create_dir_all(crate::config::directory())?;
    let path = cache_file_path();
    let contents = serde_json::to_string_pretty(cache)?;
    fs::write(&path, contents).context("failed to write update cache")?;
    Ok(())
}

pub fn should_check_for_updates() -> bool {
    if let Ok(Some(cached)) = load_cache() {
        let elapsed = SystemTime::now()
            .duration_since(cached.last_check)
            .unwrap_or(Duration::MAX);
        elapsed >= Duration::from_secs(UPDATE_CHECK_INTERVAL_HOURS * 3600)
    } else {
        true
    }
}

pub fn format_update_notification(info: &UpdateInfo) -> String {
    format!(
        "A new version of Quyan CLI is available: {} → {}\nRun 'quyan update' to install.",
        info.current_version, info.latest_version
    )
}

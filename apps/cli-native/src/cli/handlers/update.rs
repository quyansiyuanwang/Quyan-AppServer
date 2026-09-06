use anyhow::Result;
use serde_json::json;

use crate::features::updater;

pub async fn handle_update(check_only: bool, json_output: bool) -> Result<()> {
    if check_only {
        match updater::check_for_updates(true).await? {
            Some(info) => {
                if json_output {
                    super::common::print_value(
                        json!({
                            "updateAvailable": true,
                            "currentVersion": info.current_version,
                            "latestVersion": info.latest_version,
                            "downloadUrl": info.download_url,
                            "releaseNotes": info.release_notes,
                            "publishedAt": info.published_at
                        }),
                        json_output,
                    )
                } else {
                    println!("{}", updater::format_update_notification(&info));
                    if !info.release_notes.is_empty() {
                        println!("\nRelease notes:\n{}", info.release_notes);
                    }
                    Ok(())
                }
            }
            None => super::common::print_value(
                json!({"updateAvailable": false, "message": "You are using the latest version"}),
                json_output,
            ),
        }
    } else {
        match updater::check_for_updates(true).await? {
            Some(info) => {
                if !json_output {
                    println!(
                        "Updating from {} to {}...",
                        info.current_version, info.latest_version
                    );
                }
                updater::download_and_install_update(&info).await?;
                super::common::print_value(
                    json!({
                        "updated": true,
                        "oldVersion": info.current_version,
                        "newVersion": info.latest_version
                    }),
                    json_output,
                )
            }
            None => super::common::print_value(
                json!({"updated": false, "message": "Already up to date"}),
                json_output,
            ),
        }
    }
}

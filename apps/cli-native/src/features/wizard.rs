use anyhow::{Context, Result};
use serde_json::Value;
use std::io::{self, Write};

use crate::core::api::ApiClient;
use crate::services::relay;

pub async fn token_creation_wizard(api: &ApiClient) -> Result<Value> {
    println!("🧙 Relay Token Creation Wizard");
    println!("================================\n");

    // Step 1: Token name
    print!("Token name (default: Quyan CLI token): ");
    io::stdout().flush()?;
    let mut name = String::new();
    io::stdin().read_line(&mut name)?;
    let name = name.trim();
    let name = if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    };

    // Step 2: Get available channels
    println!("\nFetching available channels...");
    let channels_response = relay::channels(api).await?;
    let channels = channels_response
        .get("channels")
        .and_then(|v| v.as_array())
        .context("Invalid channels response")?;

    if channels.is_empty() {
        println!("⚠️  No channels available. Continuing without channel selection.");
    } else {
        println!("\nAvailable channels:");
        for (idx, channel) in channels.iter().enumerate() {
            let id = channel
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let name = channel
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let status = channel
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            println!("  {}. {} ({}) - {}", idx + 1, name, id, status);
        }
    }

    // Step 3: Channel selection
    let selected_channels = if !channels.is_empty() {
        print!("\nSelect channels (comma-separated numbers, or press Enter for all): ");
        io::stdout().flush()?;
        let mut selection = String::new();
        io::stdin().read_line(&mut selection)?;
        let selection = selection.trim();

        if selection.is_empty() {
            None
        } else {
            let indices: Vec<usize> = selection
                .split(',')
                .filter_map(|s| s.trim().parse::<usize>().ok())
                .filter(|&i| i > 0 && i <= channels.len())
                .collect();

            if indices.is_empty() {
                None
            } else {
                let selected_ids: Vec<String> = indices
                    .iter()
                    .filter_map(|&i| {
                        channels
                            .get(i - 1)
                            .and_then(|c| c.get("id"))
                            .and_then(|v| v.as_str())
                            .map(String::from)
                    })
                    .collect();
                Some(selected_ids.join(","))
            }
        }
    } else {
        None
    };

    // Step 4: Failover configuration
    print!("\nEnable failover? (y/N): ");
    io::stdout().flush()?;
    let mut failover_input = String::new();
    io::stdin().read_line(&mut failover_input)?;
    let failover = failover_input.trim().eq_ignore_ascii_case("y");

    let max_retries = if failover {
        print!("Max retries per channel (default: 2): ");
        io::stdout().flush()?;
        let mut retries_input = String::new();
        io::stdin().read_line(&mut retries_input)?;
        let retries = retries_input.trim();
        if retries.is_empty() {
            Some(2)
        } else {
            retries.parse::<u32>().ok()
        }
    } else {
        None
    };

    // Step 5: Stream configuration
    print!("\nSet preflight buffer size in MB (default: skip, press Enter to skip): ");
    io::stdout().flush()?;
    let mut buffer_input = String::new();
    io::stdin().read_line(&mut buffer_input)?;
    let buffer_mb = if buffer_input.trim().is_empty() {
        None
    } else {
        buffer_input.trim().parse::<f32>().ok()
    };

    // Summary
    println!("\n📋 Configuration Summary:");
    println!("  Name: {}", name.as_deref().unwrap_or("Quyan CLI token"));
    println!(
        "  Channels: {}",
        selected_channels.as_deref().unwrap_or("All")
    );
    println!(
        "  Failover: {}",
        if failover { "Enabled" } else { "Disabled" }
    );
    if let Some(retries) = max_retries {
        println!("  Max Retries: {}", retries);
    }
    if let Some(buffer) = buffer_mb {
        println!("  Preflight Buffer: {} MB", buffer);
    }

    print!("\nCreate token with this configuration? (Y/n): ");
    io::stdout().flush()?;
    let mut confirm = String::new();
    io::stdin().read_line(&mut confirm)?;

    if confirm.trim().eq_ignore_ascii_case("n") {
        println!("❌ Token creation cancelled.");
        return Ok(serde_json::json!({"cancelled": true}));
    }

    // Create the token
    println!("\n⏳ Creating token...");
    let result = relay::create_token(
        api,
        name,
        selected_channels,
        failover,
        max_retries,
        buffer_mb,
    )
    .await?;

    println!("✅ Token created successfully!");
    Ok(result)
}

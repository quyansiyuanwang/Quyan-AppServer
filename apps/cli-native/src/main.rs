#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if let Err(error) = quyan::cli::run().await {
        let debug = std::env::args_os().any(|arg| arg == "--debug");
        let message = if debug {
            format!("{error:#}")
        } else {
            error.to_string()
        };
        eprintln!("quyan: {}", quyan::utils::logging::redact(&message));
        if debug {
            if let Some(path) = quyan::utils::logging::current_log_path() {
                eprintln!("log: {}", path.display());
            }
        }
        std::process::exit(1);
    }
    Ok(())
}

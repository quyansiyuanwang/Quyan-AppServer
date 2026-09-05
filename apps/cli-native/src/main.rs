#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if let Err(error) = quyan::cli::run().await {
        eprintln!("quyan: {}", quyan::logging::redact(&format!("{error:#}")));
        if let Some(path) = quyan::logging::current_log_path() {
            eprintln!("diagnostic log: {}", path.display());
        }
        std::process::exit(1);
    }
    Ok(())
}

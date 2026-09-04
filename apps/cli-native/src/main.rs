#[tokio::main]
async fn main() -> anyhow::Result<()> {
    quyan::cli::run().await
}

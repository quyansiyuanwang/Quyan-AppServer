use clap::{ArgAction, Args, Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(
    name = "quyan",
    about = "Quyan native command-line client",
    disable_version_flag = true
)]
pub struct Cli {
    #[arg(short = 'v', long, global = true, action = ArgAction::SetTrue)]
    pub version: bool,
    #[arg(long, global = true)]
    pub json: bool,
    #[arg(long, global = true, default_value = "zh-CN", value_parser = ["zh-CN", "en-US"])]
    pub lang: String,
    #[arg(long, global = true)]
    pub no_color: bool,
    #[arg(long, global = true)]
    pub debug: bool,
    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    Login(LoginArgs),
    Credential {
        #[command(subcommand)]
        command: CredentialCommand,
    },
    Logout,
    Status,
    Account,
    Relay {
        #[command(subcommand)]
        command: RelayCommand,
    },
    Apply(ApplyArgs),
    Config {
        #[command(subcommand)]
        command: ConfigCommand,
    },
    Product {
        #[command(subcommand)]
        command: ProductCommand,
    },
    Update {
        #[arg(long)]
        check: bool,
    },
    Version,
}

#[derive(Debug, Args)]
pub struct LoginArgs {
    #[arg(long, conflicts_with = "qrcode")]
    pub browser: bool,
    #[arg(long, conflicts_with = "browser")]
    pub qrcode: bool,
}

#[derive(Debug, Subcommand)]
pub enum CredentialCommand {
    Import {
        #[arg(long)]
        stdin: bool,
    },
}

#[derive(Debug, Subcommand)]
pub enum RelayCommand {
    Token {
        #[command(subcommand)]
        command: RelayTokenCommand,
    },
    Channels {
        #[command(subcommand)]
        command: ChannelsCommand,
    },
}

#[derive(Debug, Subcommand)]
pub enum RelayTokenCommand {
    List,
    Create(CreateRelayTokenArgs),
    Update {
        id: String,
    },
    Delete {
        id: String,
    },
    DeleteBatch {
        ids: String,
    },
    Usage {
        id: String,
    },
    Stats {
        id: Option<String>,
    },
    Visualize,
    Export {
        #[arg(long)]
        output: Option<String>,
    },
    Health {
        id: String,
    },
    Wizard,
}

#[derive(Debug, Args)]
pub struct CreateRelayTokenArgs {
    #[arg(long)]
    pub name: Option<String>,
    #[arg(long)]
    pub channels: Option<String>,
    #[arg(long)]
    pub failover: bool,
    #[arg(long)]
    pub max_retries: Option<u32>,
    #[arg(long)]
    pub preflight_buffer_mb: Option<f32>,
}

#[derive(Debug, Subcommand)]
pub enum ChannelsCommand {
    List,
}

#[derive(Debug, Args)]
pub struct ApplyArgs {
    #[arg(long)]
    pub client: Option<String>,
    #[arg(long)]
    pub dry_run: bool,
    #[arg(long)]
    pub no_backup: bool,
}

#[derive(Debug, Subcommand)]
pub enum ConfigCommand {
    Get,
    Set { key: String, value: String },
    Reset,
}

#[derive(Debug, Subcommand)]
pub enum ProductCommand {
    JsonEndpoints {
        #[command(subcommand)]
        command: ProductJsonCommand,
    },
}

#[derive(Debug, Subcommand)]
pub enum ProductJsonCommand {
    Get,
    Update {
        #[arg(long)]
        file: String,
    },
    Clear,
    Usage,
}

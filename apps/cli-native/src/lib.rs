pub mod api;
pub mod branding;
pub mod cli;
pub mod config;
pub mod credentials;
pub mod integrations;
pub mod logging;
pub mod services;
pub mod tui;

pub mod generated {
    #![allow(clippy::all)]
    #![allow(dead_code)]
    include!(concat!(env!("OUT_DIR"), "/codegen.rs"));
}

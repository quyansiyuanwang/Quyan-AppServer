pub mod cli;
pub mod core;
pub mod features;
pub mod services;
pub mod utils;

pub mod generated {
    #![allow(clippy::all)]
    #![allow(dead_code)]
    include!(concat!(env!("OUT_DIR"), "/codegen.rs"));
}

use anyhow::Result;
use serde_json::Value;
use std::sync::OnceLock;

static LOCALE: OnceLock<String> = OnceLock::new();
pub fn set_locale(locale: &str) {
    let _ = LOCALE.set(locale.into());
}

pub fn print_value(value: Value, json_output: bool) -> Result<()> {
    if json_output {
        println!("{}", serde_json::to_string(&value)?);
    } else if let Some(version) = value.get("version").and_then(Value::as_str) {
        println!("quyan {version}");
    } else {
        println!(
            "{}",
            crate::utils::output::human(
                &value,
                LOCALE.get().map(String::as_str).unwrap_or("zh-CN")
            )
        );
    }
    Ok(())
}

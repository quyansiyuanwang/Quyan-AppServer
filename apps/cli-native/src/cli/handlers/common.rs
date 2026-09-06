use anyhow::Result;
use serde_json::Value;

pub fn print_value(value: Value, json_output: bool) -> Result<()> {
    if json_output {
        println!("{}", serde_json::to_string(&value)?);
    } else if let Some(version) = value.get("version").and_then(Value::as_str) {
        println!("quyan {version}");
    } else {
        println!("{}", serde_json::to_string_pretty(&value)?);
    }
    Ok(())
}

use std::io::{self, Write};

/// Shared ASCII-only identity shown by the human-facing CLI and TUI.
pub const QUYAN_BANNER: &str = r#"  ____        __  __
 / __ \__  __/ /_/ /_  ____ _____
/ / / / / / / __/ __ \/ __ `/ __ \
/ /_/ / /_/ / /_/ / / / /_/ / / / /
\___\_\__,_/\__/_/ /_/\__,_/_/ /_/"#;

pub fn print() {
    let mut stdout = io::stdout();
    let _ = writeln!(stdout, "{QUYAN_BANNER}");
}

#[cfg(test)]
mod tests {
    use super::QUYAN_BANNER;

    #[test]
    fn banner_is_ascii_and_branded() {
        assert!(QUYAN_BANNER.is_ascii());
        assert!(QUYAN_BANNER.contains("/ /_/"));
    }
}

use std::io::{self, Write};

/// Shared ASCII-only identity shown by the human-facing CLI and TUI.
pub const QUYAN_BANNER: &str = include_str!("../../assets/quyan-banner.txt");

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
        assert_eq!(QUYAN_BANNER, include_str!("../assets/quyan-banner.txt"));
    }
}

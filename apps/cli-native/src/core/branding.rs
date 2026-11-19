/// Shared ASCII-only identity displayed on demand in the TUI help.
pub const QUYAN_BANNER: &str = include_str!("../../assets/quyan-banner.txt");

#[cfg(test)]
mod tests {
    use super::QUYAN_BANNER;

    #[test]
    fn banner_is_ascii_and_branded() {
        assert!(QUYAN_BANNER.is_ascii());
        assert!(QUYAN_BANNER.contains("/ /_/"));
        assert_eq!(QUYAN_BANNER, include_str!("../../assets/quyan-banner.txt"));
    }
}

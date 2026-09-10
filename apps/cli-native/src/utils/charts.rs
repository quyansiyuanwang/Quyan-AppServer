/// Simple ASCII chart rendering utilities for CLI display

pub fn render_bar_chart(data: &[(String, u64)], max_width: usize, title: &str) -> String {
    if data.is_empty() {
        return format!("{}\n(No data)", title);
    }

    let max_value = data.iter().map(|(_, v)| v).max().copied().unwrap_or(1);
    let mut output = String::new();

    output.push_str(title);
    output.push('\n');
    output.push_str(&"=".repeat(title.len()));
    output.push('\n');

    for (label, value) in data {
        let bar_length = if max_value > 0 {
            ((*value as f64 / max_value as f64) * max_width as f64) as usize
        } else {
            0
        };

        let bar = "█".repeat(bar_length);
        output.push_str(&format!("{:20} | {} {}\n", label, bar, format_number(*value)));
    }

    output
}

pub fn render_sparkline(values: &[u64], width: usize) -> String {
    if values.is_empty() || width == 0 {
        return String::new();
    }

    let max_value = values.iter().max().copied().unwrap_or(1);
    let min_value = values.iter().min().copied().unwrap_or(0);
    let range = max_value.saturating_sub(min_value).max(1);

    // Sparkline characters from low to high
    let chars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

    let step = values.len() as f64 / width as f64;
    let mut result = String::new();

    for i in 0..width {
        let idx = (i as f64 * step) as usize;
        if idx < values.len() {
            let value = values[idx];
            let normalized = ((value.saturating_sub(min_value) as f64 / range as f64) * (chars.len() - 1) as f64) as usize;
            result.push(chars[normalized.min(chars.len() - 1)]);
        }
    }

    result
}

pub fn render_trend_chart(data: &[(String, u64)], _width: usize, height: usize) -> String {
    if data.is_empty() {
        return String::from("(No data)");
    }

    let values: Vec<u64> = data.iter().map(|(_, v)| *v).collect();
    let max_value = values.iter().max().copied().unwrap_or(1);

    let mut output = String::new();

    // Draw Y-axis and bars
    for row in (0..height).rev() {
        let threshold = (max_value as f64 / height as f64) * (row + 1) as f64;

        for value in &values {
            if *value as f64 >= threshold {
                output.push('█');
            } else {
                output.push(' ');
            }
        }
        output.push('\n');
    }

    // Draw X-axis
    output.push_str(&"─".repeat(values.len()));
    output.push('\n');

    output
}

fn format_number(n: u64) -> String {
    if n >= 1_000_000_000 {
        format!("{:.1}B", n as f64 / 1_000_000_000.0)
    } else if n >= 1_000_000 {
        format!("{:.1}M", n as f64 / 1_000_000.0)
    } else if n >= 1_000 {
        format!("{:.1}K", n as f64 / 1_000.0)
    } else {
        n.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_number() {
        assert_eq!(format_number(500), "500");
        assert_eq!(format_number(1_500), "1.5K");
        assert_eq!(format_number(1_500_000), "1.5M");
        assert_eq!(format_number(2_500_000_000), "2.5B");
    }

    #[test]
    fn test_sparkline_basic() {
        let values = vec![1, 2, 3, 4, 5];
        let result = render_sparkline(&values, 5);
        assert!(!result.is_empty());
        assert_eq!(result.chars().count(), 5);
    }

    #[test]
    fn test_bar_chart_empty() {
        let data: Vec<(String, u64)> = vec![];
        let result = render_bar_chart(&data, 40, "Test");
        assert!(result.contains("No data"));
    }
}

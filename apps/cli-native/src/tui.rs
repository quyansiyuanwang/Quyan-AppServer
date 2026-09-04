use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Layout},
    style::Style,
    text::{Line, Text},
    widgets::{Block, Borders, Paragraph, Wrap},
    Terminal,
};
use std::io::stdout;

use crate::{branding::QUYAN_BANNER, logging::EventBuffer};

pub struct StatusView<'a> {
    pub api_base_url: &'a str,
    pub relay_base_url: &'a str,
    pub locale: &'a str,
    pub config_path: &'a str,
    pub account_configured: bool,
    pub relay_configured: bool,
    pub product_configured: bool,
    pub log_path: &'a str,
    pub events: &'a EventBuffer,
}

pub fn run(status: StatusView<'_>) -> Result<()> {
    enable_raw_mode()?;
    let mut out = stdout();
    execute!(out, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(out);
    let mut terminal = Terminal::new(backend)?;
    let result = loop {
        terminal.draw(|frame| render_status(frame, &status))?;
        if event::poll(std::time::Duration::from_millis(200))? {
            if let Event::Key(key) = event::read()? {
                if matches!(key.code, KeyCode::Char('q') | KeyCode::Esc) {
                    break Ok(());
                }
            }
        }
    };
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    result
}

fn render_status(frame: &mut ratatui::Frame, status: &StatusView<'_>) {
    let area = frame.area();
    let [header, details, events, footer] = Layout::vertical([
        Constraint::Length(9),
        Constraint::Length(9),
        Constraint::Min(5),
        Constraint::Length(2),
    ])
    .areas(area);
    frame.render_widget(
        Paragraph::new(format!(
            "{QUYAN_BANNER}\nQuYan {}  |  CLI status",
            env!("CARGO_PKG_VERSION")
        ))
        .block(Block::default().borders(Borders::ALL).title(" QuYan "))
        .wrap(Wrap { trim: false }),
        header,
    );
    let details_text = Text::from(vec![
        Line::from("Status: running"),
        Line::from(format!("API: {}", status.api_base_url)),
        Line::from(format!("Relay: {}", status.relay_base_url)),
        Line::from(format!("Language: {}", status.locale)),
        Line::from(format!("Config: {}", status.config_path)),
        Line::from(format!(
            "Credentials: account={} relay={} product={}",
            configured(status.account_configured),
            configured(status.relay_configured),
            configured(status.product_configured)
        )),
        Line::from(format!("Log: {}", status.log_path)),
    ]);
    frame.render_widget(
        Paragraph::new(details_text)
            .block(Block::default().borders(Borders::ALL).title(" Runtime "))
            .wrap(Wrap { trim: false }),
        details,
    );
    let event_lines = status
        .events
        .entries()
        .cloned()
        .map(Line::from)
        .collect::<Vec<_>>();
    frame.render_widget(
        Paragraph::new(event_lines)
            .style(Style::default())
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(" Recent events "),
            )
            .wrap(Wrap { trim: false }),
        events,
    );
    frame.render_widget(
        Paragraph::new("q / Esc: exit").block(Block::default().borders(Borders::ALL)),
        footer,
    );
}

fn configured(value: bool) -> &'static str {
    if value {
        "configured"
    } else {
        "not configured"
    }
}

#[cfg(test)]
mod tests {
    use super::{render_status, StatusView};
    use crate::logging::EventBuffer;
    use ratatui::{backend::TestBackend, Terminal};

    #[test]
    fn status_view_renders_in_a_small_terminal() {
        let mut terminal = Terminal::new(TestBackend::new(50, 20)).expect("test terminal");
        let mut events = EventBuffer::new();
        events.push("INFO", "CLI started");
        let status = StatusView {
            api_base_url: "https://api.qysyw.cn",
            relay_base_url: "https://ai.qysyw.cn",
            locale: "zh-CN",
            config_path: "C:/config.json",
            account_configured: false,
            relay_configured: true,
            product_configured: false,
            log_path: "C:/logs/quyan.log",
            events: &events,
        };
        terminal
            .draw(|frame| render_status(frame, &status))
            .expect("render");
        let output = format!("{:?}", terminal.backend().buffer());
        assert!(output.contains("QuYan"));
        assert!(output.contains("Recent events"));
        assert!(output.contains("CLI started"));
    }
}

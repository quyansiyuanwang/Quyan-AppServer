use crossterm::event::KeyCode;
use ratatui::{
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::Line,
    widgets::{Block, Borders, Clear, List, ListItem, ListState, Paragraph, Wrap},
};

pub fn tr<'a>(locale: &str, zh: &'a str, en: &'a str) -> &'a str {
    if locale == "zh-CN" {
        zh
    } else {
        en
    }
}
pub fn safe(text: &str) -> String {
    crate::utils::logging::redact(text)
        .chars()
        .map(|c| if c.is_control() && c != '\n' { ' ' } else { c })
        .collect()
}
pub fn error(error: &anyhow::Error) -> String {
    tracing::warn!(error = %crate::utils::logging::redact(&format!("{error:#}")), "CLI operation failed");
    safe(&error.to_string())
        .lines()
        .next()
        .unwrap_or("Error")
        .to_string()
}
#[derive(Clone)]
pub struct Theme {
    pub locale: String,
    pub no_color: bool,
}
impl Theme {
    pub fn accent(&self) -> Style {
        if self.no_color {
            Style::default().add_modifier(Modifier::BOLD | Modifier::REVERSED)
        } else {
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD)
        }
    }
    pub fn muted(&self) -> Style {
        Style::default().add_modifier(Modifier::DIM)
    }
    pub fn t<'a>(&self, zh: &'a str, en: &'a str) -> &'a str {
        tr(&self.locale, zh, en)
    }
}
pub fn shell(
    frame: &mut ratatui::Frame,
    title: &str,
    status: &str,
    keys: &str,
    theme: &Theme,
) -> Rect {
    frame.render_widget(Clear, frame.area());
    let [header, body, notice, footer] = Layout::vertical([
        Constraint::Length(2),
        Constraint::Min(1),
        Constraint::Length(1),
        Constraint::Length(1),
    ])
    .areas(frame.area());
    frame.render_widget(
        Paragraph::new(Line::from(format!(" Quyan  {title}")).style(theme.accent()))
            .block(Block::default().borders(Borders::BOTTOM)),
        header,
    );
    frame.render_widget(Paragraph::new(safe(status)).style(theme.muted()), notice);
    frame.render_widget(Paragraph::new(keys), footer);
    body
}
pub fn list(
    frame: &mut ratatui::Frame,
    area: Rect,
    title: &str,
    rows: Vec<String>,
    selected: usize,
    theme: &Theme,
) {
    let entries = rows
        .into_iter()
        .map(|row| ListItem::new(safe(&row)))
        .collect::<Vec<_>>();
    let mut state = ListState::default().with_selected(
        (!entries.is_empty()).then_some(selected.min(entries.len().saturating_sub(1))),
    );
    frame.render_stateful_widget(
        List::new(entries)
            .highlight_symbol("› ")
            .highlight_style(theme.accent())
            .block(Block::default().borders(Borders::TOP).title(title)),
        area,
        &mut state,
    );
}
pub fn text(frame: &mut ratatui::Frame, area: Rect, title: &str, content: &str, scroll: u16) {
    let paragraph = Paragraph::new(safe(content))
        .wrap(Wrap { trim: false })
        .block(Block::default().borders(Borders::TOP).title(title));
    let max = paragraph
        .line_count(area.width)
        .saturating_sub(area.height as usize)
        .min(u16::MAX as usize) as u16;
    frame.render_widget(paragraph.scroll((scroll.min(max), 0)), area);
}
pub fn scroll(key: KeyCode, offset: &mut u16, lines: usize, height: u16) -> bool {
    let max = lines
        .saturating_sub(height.saturating_sub(1) as usize)
        .min(u16::MAX as usize) as u16;
    match key {
        KeyCode::Down | KeyCode::Char('j') => *offset = offset.saturating_add(1).min(max),
        KeyCode::Up | KeyCode::Char('k') => *offset = offset.saturating_sub(1),
        KeyCode::PageDown => {
            *offset = offset
                .saturating_add(height.saturating_sub(2).max(1))
                .min(max)
        }
        KeyCode::PageUp => *offset = offset.saturating_sub(height.saturating_sub(2).max(1)),
        KeyCode::Home => *offset = 0,
        KeyCode::End => *offset = max,
        _ => return false,
    }
    true
}
pub fn text_scroll(key: KeyCode, offset: &mut u16, content: &str, width: u16, height: u16) -> bool {
    let lines = Paragraph::new(safe(content))
        .wrap(Wrap { trim: false })
        .line_count(width.max(1));
    scroll(key, offset, lines, height)
}
pub fn navigate(key: KeyCode, selected: &mut usize, len: usize, height: u16) -> bool {
    if len == 0 {
        *selected = 0;
        return false;
    }
    match key {
        KeyCode::Down | KeyCode::Char('j') => *selected = (*selected + 1).min(len - 1),
        KeyCode::Up | KeyCode::Char('k') => *selected = selected.saturating_sub(1),
        KeyCode::Home => *selected = 0,
        KeyCode::End => *selected = len - 1,
        KeyCode::PageDown => {
            *selected = selected
                .saturating_add(height.saturating_sub(2).max(1) as usize)
                .min(len - 1)
        }
        KeyCode::PageUp => {
            *selected = selected.saturating_sub(height.saturating_sub(2).max(1) as usize)
        }
        _ => return false,
    }
    true
}
pub fn help(frame: &mut ratatui::Frame, content: &str, scroll: u16, theme: &Theme) {
    let area = shell(
        frame,
        theme.t("帮助", "Help"),
        "",
        theme.t("↑↓ 滚动  Esc 返回", "↑↓ scroll  Esc back"),
        theme,
    );
    text(frame, area, "?", content, scroll);
}
pub const POLL_TICK: std::time::Duration = std::time::Duration::from_millis(80);

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pagination_and_scrolling_stay_in_bounds() {
        let mut selected = 0;
        navigate(KeyCode::End, &mut selected, 99, 20);
        assert_eq!(selected, 98);
        navigate(KeyCode::PageDown, &mut selected, 99, 20);
        assert_eq!(selected, 98);
        let mut offset = 0;
        scroll(KeyCode::End, &mut offset, 100, 20);
        assert_eq!(offset, 81);
        scroll(KeyCode::Home, &mut offset, 100, 20);
        assert_eq!(offset, 0);
        assert_eq!(safe("test\u{1b}[31m"), "test [31m");
    }
    #[test]
    fn wrapped_content_can_scroll_to_the_last_visible_line() {
        let content = "long ".repeat(100);
        let mut offset = 0;
        text_scroll(KeyCode::End, &mut offset, &content, 20, 8);
        assert!(offset > 8);
        let mut terminal =
            ratatui::Terminal::new(ratatui::backend::TestBackend::new(20, 8)).unwrap();
        terminal
            .draw(|frame| text(frame, frame.area(), "", &content, offset))
            .unwrap();
        assert!(format!("{:?}", terminal.backend().buffer()).contains("long"));
    }
}

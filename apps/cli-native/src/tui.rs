use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Layout},
    widgets::{Block, Borders, List, ListItem, Paragraph},
    Terminal,
};
use std::io::stdout;

use crate::branding::QUYAN_BANNER;

pub fn run(items: &[String]) -> Result<()> {
    enable_raw_mode()?;
    let mut out = stdout();
    execute!(out, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(out);
    let mut terminal = Terminal::new(backend)?;
    let result = loop {
        terminal.draw(|frame| {
            let areas =
                Layout::vertical([Constraint::Length(7), Constraint::Min(1)]).split(frame.area());
            frame.render_widget(
                Paragraph::new(format!("{QUYAN_BANNER}\nQuYan  |  Relay Tokens"))
                    .block(Block::default().borders(Borders::ALL)),
                areas[0],
            );
            let list = List::new(
                items
                    .iter()
                    .map(|item| ListItem::new(item.clone()))
                    .collect::<Vec<_>>(),
            )
            .block(Block::default().borders(Borders::ALL));
            frame.render_widget(list, areas[1]);
        })?;
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

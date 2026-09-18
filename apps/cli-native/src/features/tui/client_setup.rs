use crate::features::integrations::{self, ClientKind};
use crossterm::event::KeyCode;
use ratatui::{
    layout::{Constraint, Layout},
    widgets::{Block, Borders, Paragraph, Wrap},
};

#[derive(Default)]
pub(super) struct ClientSetup {
    selected: usize,
    model: String,
    preview: Option<String>,
    notice: String,
}

impl ClientSetup {
    fn client(&self) -> ClientKind {
        ClientKind::configurable()[self.selected]
    }
    pub fn key(&mut self, key: KeyCode, base: &str) {
        if self.preview.is_some() {
            match key {
                KeyCode::Char('y') => {
                    self.notice = match integrations::apply(
                        self.client(),
                        base,
                        Some(&self.model),
                        false,
                        true,
                    ) {
                        Ok(value) => format!(
                            "Saved. Backup: {}\nLaunch with: quyan launch --client {}",
                            value["backup"],
                            self.client().id()
                        ),
                        Err(error) => crate::utils::logging::redact(&format!(
                            "Configuration not applied: {error:#}"
                        )),
                    };
                    self.preview = None;
                }
                KeyCode::Char('n') => {
                    self.preview = None;
                    self.notice = "Cancelled; no files changed.".into();
                }
                _ => {}
            }
            return;
        }
        match key {
            KeyCode::Tab | KeyCode::Down => {
                self.selected = (self.selected + 1) % ClientKind::configurable().len()
            }
            KeyCode::Up => {
                self.selected = self
                    .selected
                    .checked_sub(1)
                    .unwrap_or(ClientKind::configurable().len() - 1)
            }
            KeyCode::Backspace => {
                self.model.pop();
            }
            KeyCode::Char(ch) if !ch.is_control() => {
                self.model.push(ch);
            }
            KeyCode::Enter => {
                match integrations::apply(self.client(), base, Some(&self.model), true, true) {
                    Ok(value) => self.preview = Some(serde_json::to_string_pretty(&value).unwrap()),
                    Err(error) => {
                        self.notice = crate::utils::logging::redact(&format!(
                            "Cannot prepare configuration: {error:#}"
                        ))
                    }
                }
            }
            _ => {}
        }
    }
    pub fn render(&self, frame: &mut ratatui::Frame, status: &super::StatusView<'_>) {
        let [body, footer] =
            Layout::vertical([Constraint::Min(10), Constraint::Length(3)]).areas(frame.area());
        let text = if let Some(preview) = &self.preview {
            format!("{preview}\n\nConfirm writing this client's configuration? Existing files will be backed up.\nOnly URL/model/environment-variable references are saved, never the Relay Token.")
        } else {
            format!("Client: {}\nRelay URL: {}\nRelay credential: {}\n\nModel: {}\nType a model ID from your Relay catalog (required for pi; optional for other clients).\n\nUse AI Relay > u to select a token first.\nAfter configuration, run: quyan launch --client {}\n\nGeneric harnesses: quyan launch --client openai -- <program>\n                  quyan launch --client anthropic -- <program>\n\n{}", self.client().id(), status.relay_base_url, super::configured(status.relay_configured), self.model, self.client().id(), self.notice)
        };
        frame.render_widget(
            Paragraph::new(text)
                .block(
                    Block::default()
                        .borders(Borders::ALL)
                        .title(" AI client configuration / 配置 AI 客户端 "),
                )
                .wrap(Wrap { trim: false }),
            body,
        );
        super::render_footer(
            frame,
            footer,
            if self.preview.is_some() {
                "y: confirm + backup | n: cancel | Esc: back"
            } else {
                "Tab/Up/Down: client | type: model | Enter: preview | Esc: back"
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn entering_and_editing_never_writes_files() {
        let mut view = ClientSetup::default();
        view.key(KeyCode::Tab, "https://relay.test");
        assert_eq!(view.client(), ClientKind::Codex);
        view.key(KeyCode::Char('x'), "https://relay.test");
        assert_eq!(view.model, "x");
        assert!(view.preview.is_none());
    }
}

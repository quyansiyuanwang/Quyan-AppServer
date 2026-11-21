use super::ui::{self, Theme};
use crate::{
    core::api::ApiClient,
    features::integrations::{self, ClientKind},
    router::{
        config::RouterModels,
        routing::{self, Protocol},
    },
};
use crossterm::event::KeyCode;
use ratatui::layout::{Constraint, Layout};
use serde_json::Value;
use tokio::task::JoinHandle;

#[derive(Clone)]
pub(super) struct LaunchRequest {
    pub client: ClientKind,
    pub router: bool,
    pub model: Option<String>,
}
pub(super) enum Action {
    None,
    Back,
    Launch(LaunchRequest),
}
struct Prepared {
    request: LaunchRequest,
    base: String,
    expected: Option<String>,
    value: Value,
    path: std::path::PathBuf,
    router_config: Option<crate::router::config::RouterConfig>,
}
fn prepare_at(
    request: LaunchRequest,
    base: String,
    path: std::path::PathBuf,
    router_config: Option<crate::router::config::RouterConfig>,
) -> anyhow::Result<Prepared> {
    let expected = integrations::files::read(&path)?;
    let value = if let Some(config) = &router_config {
        crate::router::clients::apply_at(
            request.client,
            &path,
            config,
            request.model.as_deref(),
            true,
        )?
    } else {
        integrations::apply_at(
            request.client,
            &path,
            &base,
            request.model.as_deref(),
            true,
            true,
        )?
    };
    Ok(Prepared {
        request,
        base,
        expected,
        value,
        path,
        router_config,
    })
}
fn apply_prepared(prepared: Prepared) -> anyhow::Result<Value> {
    anyhow::ensure!(
        integrations::files::read(&prepared.path)? == prepared.expected,
        "Config changed; preview again"
    );
    if let Some(config) = &prepared.router_config {
        anyhow::ensure!(
            crate::router::config::load()? == *config,
            "Router changed; preview again"
        );
        crate::router::clients::apply_at(
            prepared.request.client,
            &prepared.path,
            config,
            prepared.request.model.as_deref(),
            false,
        )
    } else {
        integrations::apply_at(
            prepared.request.client,
            &prepared.path,
            &prepared.base,
            prepared.request.model.as_deref(),
            false,
            true,
        )
    }
}
enum Edit {
    Manual(String),
    Picker {
        query: String,
        selected: usize,
        typing: bool,
    },
}
pub(super) struct ClientSetup {
    theme: Theme,
    client: usize,
    router: bool,
    focus: usize,
    model: String,
    models: Vec<String>,
    edit: Option<Edit>,
    preview: Option<Prepared>,
    preparing: Option<JoinHandle<anyhow::Result<Prepared>>>,
    writing: Option<JoinHandle<anyhow::Result<Value>>>,
    catalog: Option<JoinHandle<anyhow::Result<(Vec<String>, String)>>>,
    notice: String,
    scroll: u16,
    address: String,
}
fn protocol(client: ClientKind) -> Protocol {
    match client {
        ClientKind::ClaudeCode => Protocol::Anthropic,
        ClientKind::Codex => Protocol::OpenaiResponses,
        _ => Protocol::Openai,
    }
}
impl ClientSetup {
    pub fn new(theme: Theme) -> Self {
        Self {
            theme,
            client: 0,
            router: false,
            focus: 0,
            model: String::new(),
            models: vec![],
            edit: None,
            preview: None,
            preparing: None,
            writing: None,
            catalog: None,
            notice: String::new(),
            scroll: 0,
            address: String::new(),
        }
    }
    pub fn select_router(&mut self, client: ClientKind, model: Option<String>, api: &ApiClient) {
        if self.busy() || self.preparing.is_some() {
            return;
        }
        self.client = ClientKind::configurable()
            .iter()
            .position(|c| *c == client)
            .unwrap_or(0);
        self.router = true;
        self.model = model.unwrap_or_default();
        self.focus = 3;
        self.edit = None;
        self.preview = None;
        self.refresh(api);
    }
    fn client(&self) -> ClientKind {
        ClientKind::configurable()[self.client]
    }
    pub fn busy(&self) -> bool {
        self.writing.is_some()
    }
    pub fn captures(&self) -> bool {
        self.edit.is_some() || self.preview.is_some()
    }
    pub fn refresh(&mut self, api: &ApiClient) {
        if let Some(task) = self.catalog.take() {
            task.abort();
        }
        self.models.clear();
        self.address.clear();
        self.notice = self.theme.t("加载模型…", "Loading models…").into();
        let client = self.client();
        let router = self.router;
        let api = api.clone();
        self.catalog = Some(tokio::spawn(async move {
            if router {
                tokio::task::spawn_blocking(move || {
                    let config = crate::router::config::load()?;
                    let models = if client == ClientKind::Pi {
                        Protocol::ALL
                            .into_iter()
                            .flat_map(|protocol| routing::aggregate_models(&config, protocol))
                            .collect::<std::collections::BTreeSet<_>>()
                            .into_iter()
                            .collect()
                    } else {
                        routing::aggregate_models(&config, protocol(client))
                    };
                    Ok((models, config.base_url()))
                })
                .await?
            } else {
                let catalog: RouterModels = crate::services::relay::selected_catalog(&api).await?;
                Ok((
                    protocol(client).models(&catalog).to_vec(),
                    api.relay_base_url.clone(),
                ))
            }
        }));
    }
    pub async fn poll(&mut self) {
        if self.catalog.as_ref().is_some_and(JoinHandle::is_finished) {
            match self.catalog.take().unwrap().await {
                Ok(Ok((models, address))) => {
                    self.models = models;
                    self.address = address;
                    self.notice.clear();
                }
                Ok(Err(error)) => self.notice = ui::error(&error),
                Err(_) => self.notice = self.theme.t("模型加载失败", "Model load failed").into(),
            }
        }
        if self.preparing.as_ref().is_some_and(JoinHandle::is_finished) {
            match self.preparing.take().unwrap().await {
                Ok(Ok(prepared)) => {
                    self.preview = Some(prepared);
                    self.notice.clear();
                    self.scroll = 0;
                }
                Ok(Err(error)) => self.notice = ui::error(&error),
                Err(_) => self.notice = self.theme.t("预览失败", "Preview failed").into(),
            }
        }
        if self.writing.as_ref().is_some_and(JoinHandle::is_finished) {
            self.notice = match self.writing.take().unwrap().await {
                Ok(Ok(value)) => {
                    if let Some(backup) = value["backup"].as_str() {
                        format!(
                            "{} · {backup}",
                            self.theme.t("已保存，备份", "Saved; backup")
                        )
                    } else {
                        self.theme.t("已保存", "Saved").into()
                    }
                }
                Ok(Err(error)) => ui::error(&error),
                Err(_) => self
                    .theme
                    .t("写入失败，请检查配置", "Write failed; check config")
                    .into(),
            };
        }
    }
    fn request(&self) -> LaunchRequest {
        LaunchRequest {
            client: self.client(),
            router: self.router,
            model: (!self.model.trim().is_empty()).then(|| self.model.trim().to_string()),
        }
    }
    fn prepare(&mut self, api: &ApiClient) {
        if self.busy() || self.preparing.is_some() {
            return;
        }
        let request = self.request();
        let base = api.relay_base_url.clone();
        self.notice = self.theme.t("准备预览…", "Preparing preview…").into();
        self.preparing = Some(tokio::task::spawn_blocking(move || {
            let path = integrations::config_path(request.client)?;
            let router_config = if request.router {
                Some(crate::router::config::load()?)
            } else {
                None
            };
            prepare_at(request, base, path, router_config)
        }));
    }
    pub fn key(&mut self, key: KeyCode, api: &ApiClient, width: u16, height: u16) -> Action {
        if let Some(edit) = &mut self.edit {
            match edit {
                Edit::Manual(text) => match key {
                    KeyCode::Esc => self.edit = None,
                    KeyCode::Enter => {
                        self.model = text.trim().into();
                        self.edit = None;
                    }
                    KeyCode::Backspace => {
                        text.pop();
                    }
                    KeyCode::Char(ch) if !ch.is_control() && text.len() < 256 => text.push(ch),
                    _ => {}
                },
                Edit::Picker {
                    query,
                    selected,
                    typing,
                } => {
                    let models = self
                        .models
                        .iter()
                        .filter(|m| m.to_lowercase().contains(&query.to_lowercase()))
                        .collect::<Vec<_>>();
                    match key {
                        KeyCode::Esc if *typing => *typing = false,
                        KeyCode::Esc => self.edit = None,
                        KeyCode::Enter => {
                            if let Some(model) = models.get(*selected) {
                                self.model = (*model).clone();
                                self.edit = None;
                            }
                        }
                        KeyCode::Char('/') if !*typing => *typing = true,
                        KeyCode::Char('i') if !*typing => {
                            self.edit = Some(Edit::Manual(self.model.clone()))
                        }
                        KeyCode::Backspace if *typing => {
                            query.pop();
                            *selected = 0;
                        }
                        KeyCode::Char(ch) if *typing && !ch.is_control() => {
                            query.push(ch);
                            *selected = 0;
                        }
                        _ => {
                            ui::navigate(key, selected, models.len(), height);
                        }
                    }
                }
            }
            return Action::None;
        }
        if self.preview.is_some() {
            match key {
                KeyCode::Char('y') if !self.busy() => {
                    let prepared = self.preview.take().unwrap();
                    self.notice = self.theme.t("保存中…", "Saving…").into();
                    self.writing = Some(tokio::task::spawn_blocking(move || {
                        apply_prepared(prepared)
                    }));
                }
                KeyCode::Char('n') | KeyCode::Esc | KeyCode::Enter => self.preview = None,
                _ => {
                    let content = self
                        .preview
                        .as_ref()
                        .map(|p| crate::utils::output::human(&p.value, &self.theme.locale))
                        .unwrap_or_default();
                    ui::text_scroll(key, &mut self.scroll, &content, width, height);
                }
            }
            return Action::None;
        }
        if self.busy() || self.preparing.is_some() {
            return if key == KeyCode::Esc {
                Action::Back
            } else {
                Action::None
            };
        }
        match key {
            KeyCode::Esc => return Action::Back,
            KeyCode::Tab | KeyCode::Down | KeyCode::Char('j') => self.focus = (self.focus + 1) % 4,
            KeyCode::BackTab | KeyCode::Up | KeyCode::Char('k') => {
                self.focus = (self.focus + 3) % 4
            }
            KeyCode::Left | KeyCode::Right if self.focus == 0 => {
                let len = ClientKind::configurable().len();
                self.client = (self.client + if key == KeyCode::Right { 1 } else { len - 1 }) % len;
                self.model.clear();
                self.refresh(api);
            }
            KeyCode::Left | KeyCode::Right | KeyCode::Char(' ') if self.focus == 1 => {
                self.router = !self.router;
                self.model.clear();
                self.refresh(api);
            }
            KeyCode::Char('i') => self.edit = Some(Edit::Manual(self.model.clone())),
            KeyCode::Enter if self.focus == 2 => {
                self.edit = Some(Edit::Picker {
                    query: String::new(),
                    selected: 0,
                    typing: false,
                })
            }
            KeyCode::Char('m') => {
                self.edit = Some(Edit::Picker {
                    query: String::new(),
                    selected: 0,
                    typing: false,
                })
            }
            KeyCode::Enter | KeyCode::Char('a') => self.prepare(api),
            KeyCode::Char('r') => self.refresh(api),
            KeyCode::Char('l') => return Action::Launch(self.request()),
            _ => {}
        }
        Action::None
    }
    pub fn launched(&mut self, result: anyhow::Result<()>) {
        self.notice = match result {
            Ok(()) => self.theme.t("客户端已退出", "Client exited").into(),
            Err(error) => ui::error(&error),
        };
    }
    pub fn render(&self, frame: &mut ratatui::Frame, status: &super::StatusView<'_>) {
        let footer = if self.preview.is_some() {
            self.theme.t("y 保存  n/Esc 取消", "y save  n/Esc cancel")
        } else if self.edit.is_some() {
            self.theme.t(
                "Enter 选择  / 搜索  Esc 返回",
                "Enter select  / search  Esc back",
            )
        } else {
            self.theme.t(
                "Tab 字段  ←→ 切换  a 配置  l 启动  ? 帮助",
                "Tab field  ←→ switch  a apply  l launch  ? help",
            )
        };
        let area = ui::shell(
            frame,
            self.theme.t("AI 客户端", "AI clients"),
            &self.notice,
            footer,
            &self.theme,
        );
        if let Some(preview) = &self.preview {
            ui::text(
                frame,
                area,
                self.theme.t("配置预览", "Config preview"),
                &crate::utils::output::human(&preview.value, &self.theme.locale),
                self.scroll,
            );
            return;
        }
        if let Some(Edit::Manual(text)) = &self.edit {
            ui::text(
                frame,
                area,
                self.theme.t("模型 ID", "Model ID"),
                &format!("{text}▏"),
                0,
            );
            return;
        }
        if let Some(Edit::Picker {
            query, selected, ..
        }) = &self.edit
        {
            let [search, list] =
                Layout::vertical([Constraint::Length(1), Constraint::Min(1)]).areas(area);
            frame.render_widget(
                ratatui::widgets::Paragraph::new(format!("/ {query}")),
                search,
            );
            let rows = self
                .models
                .iter()
                .filter(|m| m.to_lowercase().contains(&query.to_lowercase()))
                .cloned()
                .collect::<Vec<_>>();
            ui::list(
                frame,
                list,
                self.theme.t("模型", "Models"),
                if rows.is_empty() {
                    vec![self
                        .theme
                        .t("暂无模型 · i 手动输入", "No models · i for manual input")
                        .into()]
                } else {
                    rows
                },
                *selected,
                &self.theme,
            );
            return;
        }
        let source = if self.router {
            "Router"
        } else {
            self.theme.t("直连", "Direct")
        };
        let rows = vec![
            format!(
                "{}  ‹ {} ›",
                self.theme.t("客户端", "Client"),
                self.client().id()
            ),
            format!("{}  ‹ {source} ›", self.theme.t("连接", "Connection")),
            format!(
                "{}  {}",
                self.theme.t("模型", "Model"),
                if self.model.is_empty() {
                    "—"
                } else {
                    &self.model
                }
            ),
            self.theme.t("预览配置", "Preview configuration").into(),
        ];
        let [form, info] =
            Layout::vertical([Constraint::Length(7), Constraint::Min(1)]).areas(area);
        ui::list(frame, form, "", rows, self.focus, &self.theme);
        let connection = if self.router {
            self.address.as_str()
        } else {
            status.relay_base_url
        };
        ui::text(
            frame,
            info,
            "",
            &format!(
                "{}  {connection}\nRelay  {}",
                self.theme.t("地址", "Address"),
                if status.relay_configured {
                    "●"
                } else {
                    "○"
                }
            ),
            0,
        );
    }
    pub fn help(&self) -> String {
        self.theme.t("Tab / Shift+Tab  切换字段\n← →  切换客户端或连接\nm / Enter（模型字段）  模型列表\ni  手动输入模型\na  预览配置\nl  启动客户端\nr  刷新模型","Tab / Shift+Tab  fields\n← →  switch client or connection\nm / Enter (model field)  model picker\ni  enter model manually\na  preview configuration\nl  launch client\nr  refresh models").into()
    }
}
impl Drop for ClientSetup {
    fn drop(&mut self) {
        if let Some(task) = self.catalog.take() {
            task.abort();
        }
        if let Some(task) = self.preparing.take() {
            task.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clients_use_protocol_specific_model_catalogs() {
        assert_eq!(protocol(ClientKind::Codex), Protocol::OpenaiResponses);
        assert_eq!(protocol(ClientKind::ClaudeCode), Protocol::Anthropic);
        assert_eq!(protocol(ClientKind::Pi), Protocol::Openai);
    }
    #[test]
    fn customer_form_is_compact_and_has_three_clients() {
        let theme = Theme {
            locale: "en-US".into(),
            no_color: true,
        };
        let view = ClientSetup::new(theme);
        assert_eq!(ClientKind::configurable().len(), 3);
        assert!(!view.captures());
        assert!(!view.busy());
    }
    #[test]
    fn preview_is_read_only_and_rejects_configuration_changed_before_confirmation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"permissions":{"allow":["Read"]}}"#).unwrap();
        let request = LaunchRequest {
            client: ClientKind::ClaudeCode,
            router: false,
            model: Some("fixture-model".into()),
        };
        let original = std::fs::read_to_string(&path).unwrap();
        let prepared = prepare_at(
            request.clone(),
            "https://relay.example.test".into(),
            path.clone(),
            None,
        )
        .unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        std::fs::write(&path, r#"{"changedElsewhere":true}"#).unwrap();
        assert!(apply_prepared(prepared).is_err());
        assert!(std::fs::read_to_string(&path)
            .unwrap()
            .contains("changedElsewhere"));
        let prepared = prepare_at(
            request,
            "https://relay.example.test".into(),
            path.clone(),
            None,
        )
        .unwrap();
        let value = apply_prepared(prepared).unwrap();
        assert!(value["backup"].is_string());
        assert!(std::fs::read_to_string(&path)
            .unwrap()
            .contains("changedElsewhere"));
    }
}

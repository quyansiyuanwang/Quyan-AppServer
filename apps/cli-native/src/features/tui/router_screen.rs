//! Interactive routing workspace. Every mutation is previewed before confirmation.
use crate::{
    core::api::ApiClient,
    features::integrations::ClientKind,
    router::{
        commands::{ProfileCommand, RouteCommand, RouterCommand},
        config::{self, RouterConfig},
        routing::{self, Protocol},
    },
    utils::logging,
};
use crossterm::event::KeyCode;
use ratatui::{
    layout::{Constraint, Layout},
    style::{Color, Style},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Tabs, Wrap},
};
use serde_json::Value;

const STATUS_REFRESH_INTERVAL: std::time::Duration = std::time::Duration::from_secs(3);
const TABS: [&str; 6] = [
    "Profiles 配置档",
    "Relay Tokens 令牌",
    "Models 模型",
    "Routes 路由",
    "Clients 客户端",
    "Status 状态",
];
const CLIENTS: [ClientKind; 5] = [
    ClientKind::ClaudeCode,
    ClientKind::Codex,
    ClientKind::Pi,
    ClientKind::ClaudeDesktop,
    ClientKind::ChatgptDesktop,
];
struct SafeToken {
    id: String,
    name: String,
}
struct Preview {
    command: RouterCommand,
    description: String,
}
struct AliasEditor {
    input: String,
    upstream: String,
    profile: String,
}
pub(super) struct RouterView {
    tab: usize,
    selected: usize,
    target: usize,
    protocol: usize,
    config: RouterConfig,
    tokens: Vec<SafeToken>,
    page: u64,
    total: u64,
    status: Value,
    notice: String,
    preview: Option<Preview>,
    alias: Option<AliasEditor>,
    client_model: Option<String>,
    last_poll: std::time::Instant,
    poll_task: Option<tokio::task::JoinHandle<Value>>,
    work: Option<tokio::task::JoinHandle<anyhow::Result<Option<Value>>>>,
    token_work: Option<tokio::task::JoinHandle<anyhow::Result<Value>>>,
}
impl Default for RouterView {
    fn default() -> Self {
        Self {
            tab: 0,
            selected: 0,
            target: 0,
            protocol: 0,
            config: RouterConfig::default(),
            tokens: Vec::new(),
            page: 1,
            total: 0,
            status: Value::Null,
            notice: String::new(),
            preview: None,
            alias: None,
            client_model: None,
            last_poll: std::time::Instant::now(),
            poll_task: None,
            work: None,
            token_work: None,
        }
    }
}
impl RouterView {
    pub async fn new() -> Self {
        let mut view = Self::default();
        view.refresh().await;
        view
    }
    pub async fn poll(&mut self) {
        if self.token_work.as_ref().is_some_and(|t| t.is_finished()) {
            if let Some(task) = self.token_work.take() {
                match task.await {
                    Ok(Ok(value))=>{
                        self.total=value["total"].as_u64().unwrap_or(0);
                        self.tokens=value["items"].as_array().into_iter().flatten().filter_map(|t|Some(SafeToken {id:t["id"].as_str()?.into(),name:t["name"].as_str().unwrap_or("Relay Token").into()})).collect();
                        self.notice=format!("Loaded {} Relay Tokens / 令牌已加载",self.tokens.len());
                        if self.tab==1 {self.selected=0;}
                    },_=>self.notice="Cannot read Relay Tokens; sign in with account credentials. 请先登录账户。".into()
                }
            }
        }
        if self.work.as_ref().is_some_and(|t| t.is_finished()) {
            if let Some(task) = self.work.take() {
                self.notice = match task.await {
                    Ok(Ok(Some(value))) => logging::redact(&value.to_string()),
                    Ok(Ok(None)) => "Done / 完成".into(),
                    Ok(Err(error)) => {
                        logging::redact(&format!("Operation failed / 操作失败: {error:#}"))
                    }
                    Err(_) => {
                        "Operation could not finish; refresh to inspect its state / 请刷新检查状态"
                            .into()
                    }
                };
                self.refresh().await;
            }
        }

        if self.poll_task.as_ref().is_some_and(|t| t.is_finished()) {
            if let Some(task) = self.token_work.take() {
                task.abort();
            }
            if let Some(task) = self.poll_task.take() {
                if let Ok(value) = task.await {
                    self.status = value;
                }
            }
        }
        if self.poll_task.is_none() && self.last_poll.elapsed() >= STATUS_REFRESH_INTERVAL {
            self.last_poll = std::time::Instant::now();
            self.poll_task = Some(tokio::spawn(async {
                crate::router::process::status()
                    .await
                    .unwrap_or_else(|_| serde_json::json!({"running":false}))
            }));
            if let Ok(config) = config::load() {
                self.config = config;
            }
        }
    }
    pub fn modal(&self) -> bool {
        self.preview.is_some() || self.alias.is_some() || self.work.is_some()
    }
    fn protocol(&self) -> Protocol {
        Protocol::ALL[self.protocol]
    }
    fn models(&self) -> Vec<String> {
        routing::aggregate_models(&self.config, self.protocol())
    }
    fn rows(&self) -> Vec<String> {
        match self.tab {
            0 => self
                .config
                .profiles
                .iter()
                .map(|p| {
                    format!(
                        "{}  P{}  {}",
                        if p.enabled { "●" } else { "○" },
                        p.priority,
                        p.name
                    )
                })
                .collect(),
            1 => self
                .tokens
                .iter()
                .map(|t| format!("{}  {}", t.name, t.id))
                .collect(),
            2 => self.models(),
            3 => self
                .config
                .routes
                .iter()
                .map(|r| {
                    format!(
                        "{} {} → {} P{}",
                        r.protocol.as_str(),
                        r.model,
                        r.profile_id,
                        r.priority
                    )
                })
                .collect(),
            4 => CLIENTS
                .iter()
                .map(|c| {
                    format!(
                        "{}  {}",
                        if crate::router::clients::binding_status(*c)["bound"] == true {
                            "●"
                        } else {
                            "○"
                        },
                        c.id()
                    )
                })
                .collect(),
            _ => vec![
                "Overview / 总览".into(),
                "Recent requests / 最近请求".into(),
                "Route health / 路由健康".into(),
            ],
        }
    }
    async fn refresh(&mut self) {
        match config::load() {Ok(config)=>self.config=config,Err(_)=>self.notice="Router configuration is invalid; repair it before making changes. 配置无效，不会覆盖原文件。".into()}
        self.status=crate::router::process::status().await.unwrap_or_else(|_|serde_json::json!({"running":false,"notice":"Router record is stale or unreachable; use foreground serve to diagnose"}));
        self.selected = self.selected.min(self.rows().len().saturating_sub(1));
    }
    async fn tokens(&mut self, api: &ApiClient) {
        if let Some(task) = self.token_work.take() {
            task.abort();
        }
        let api = api.clone();
        let page = self.page;
        self.notice = "Loading Relay Tokens… / 正在加载令牌，可继续切换页面".into();
        self.token_work = Some(tokio::spawn(async move {
            crate::services::relay::tokens_page(&api, page).await
        }));
    }
    fn preview(&mut self, command: RouterCommand, description: String) {
        self.preview = Some(Preview {
            command,
            description,
        });
    }
    fn target_profile(&self, model: &str) -> Option<String> {
        let candidates = routing::candidates(&self.config, self.protocol(), model);
        candidates
            .get(self.target % candidates.len().max(1))
            .map(|c| c.profile_id.clone())
    }
    pub async fn key(&mut self, key: KeyCode, api: &ApiClient) {
        if self.work.is_some() {
            return;
        }
        if let Some(editor) = &mut self.alias {
            match key {
                KeyCode::Esc => self.alias = None,
                KeyCode::Backspace => {
                    editor.input.pop();
                }
                KeyCode::Char(c) if !c.is_control() => editor.input.push(c),
                KeyCode::Enter => {
                    let editor = self.alias.take().unwrap();
                    self.preview(
                        RouterCommand::Route {
                            command: RouteCommand::Set {
                                protocol: self.protocol(),
                                model: editor.input.clone(),
                                profile: editor.profile.clone(),
                                upstream_model: Some(editor.upstream.clone()),
                                priority: 0,
                            },
                        },
                        format!(
                            "Alias {} → {} via {} / 别名路由",
                            editor.input, editor.upstream, editor.profile
                        ),
                    );
                }
                _ => {}
            }
            return;
        }
        if self.preview.is_some() {
            match key {
                KeyCode::Esc | KeyCode::Char('n') => {
                    self.preview = None;
                    self.notice = "Cancelled; no changes made / 已取消".into();
                }
                KeyCode::Char('y') => {
                    let pending = self.preview.take().unwrap();
                    match crate::core::config::load() {
                        Ok(cfg) => {
                            self.notice =
                                "Applying confirmed operation… / 正在执行已确认操作；完成后可返回"
                                    .into();
                            self.work = Some(tokio::spawn(async move {
                                crate::router::commands::run(pending.command, true, &cfg).await
                            }));
                        }
                        Err(error) => {
                            self.notice =
                                logging::redact(&format!("Cannot load configuration: {error:#}"))
                        }
                    }
                }
                _ => {}
            }
            return;
        }
        match key {
            KeyCode::Tab => {
                self.tab = (self.tab + 1) % TABS.len();
                self.selected = 0;
                if self.tab == 1 {
                    self.tokens(api).await;
                }
            }
            KeyCode::BackTab => {
                self.tab = (self.tab + TABS.len() - 1) % TABS.len();
                self.selected = 0;
            }
            KeyCode::Up | KeyCode::Char('k') => {
                let n = self.rows().len();
                if n > 0 {
                    self.selected = (self.selected + n - 1) % n;
                }
            }
            KeyCode::Down | KeyCode::Char('j') => {
                let n = self.rows().len();
                if n > 0 {
                    self.selected = (self.selected + 1) % n;
                }
            }
            KeyCode::Char('r') => {
                self.refresh().await;
                if self.tab == 1 {
                    self.tokens(api).await;
                }
            }
            KeyCode::Char('s') => self.preview(
                RouterCommand::Start,
                "Start loopback Router / 启动本地路由".into(),
            ),
            KeyCode::Char('x') => self.preview(
                RouterCommand::Stop,
                "Stop Router; active agents will lose the local API / 停止后客户端暂时无法请求"
                    .into(),
            ),
            KeyCode::Char('f') => self.preview(
                RouterCommand::Models { refresh: true },
                "Refresh all saved model catalogs using account API / 刷新全部配置档模型".into(),
            ),
            KeyCode::Char('a') if self.tab == 0 => {
                self.tab = 1;
                self.tokens(api).await;
            }
            KeyCode::Char('n') if self.tab == 1 => {
                if self.page * crate::services::relay::TOKEN_PAGE_SIZE < self.total {
                    self.page += 1;
                    self.tokens(api).await;
                }
            }
            KeyCode::Char('b') if self.tab == 1 => {
                self.page = self.page.saturating_sub(1).max(1);
                self.tokens(api).await;
            }
            KeyCode::Char('v') if self.tab == 2 => {
                let enabled = self.config.stack_enabled;
                self.preview(
                    RouterCommand::Stack {
                        command: if enabled {
                            crate::router::commands::StackCommand::Disable
                        } else {
                            crate::router::commands::StackCommand::Enable
                        },
                    },
                    format!(
                        "{} provider-scoped Stack model IDs / {}配置档模型 ID",
                        if enabled { "Disable" } else { "Enable" },
                        if enabled { "关闭" } else { "开启" }
                    ),
                );
            }
            KeyCode::Char('p') if self.tab == 2 => {
                self.protocol = (self.protocol + 1) % Protocol::ALL.len();
                self.selected = 0;
                self.target = 0;
            }
            KeyCode::Char('t') if self.tab == 2 => self.target += 1,
            KeyCode::Char(' ') if self.tab == 2 => {
                self.client_model = self.models().get(self.selected).cloned();
                self.notice = format!(
                    "Selected client model / 已选客户端模型: {}",
                    self.client_model.as_deref().unwrap_or("none")
                );
            }
            KeyCode::Char('a') if self.tab == 2 => {
                if let Some(model) = self.models().get(self.selected).cloned() {
                    if let Some(profile) = self.target_profile(&model) {
                        self.alias = Some(AliasEditor {
                            input: String::new(),
                            upstream: model,
                            profile,
                        });
                    }
                }
            }
            KeyCode::Char('m') if self.tab == 4 => {
                self.tab = 2;
                self.selected = 0;
            }
            KeyCode::Char('d') if self.tab == 0 => {
                if let Some(profile) = self.config.profiles.get(self.selected) {
                    let id = profile.id.clone();
                    let name = profile.name.clone();
                    self.preview(RouterCommand::Profile {command:ProfileCommand::Remove {id}},format!("Remove {name}, all of its routes and keychain credential / 删除配置档及凭证"));
                }
            }
            KeyCode::Char(' ') if self.tab == 0 => {
                if let Some(profile) = self.config.profiles.get(self.selected) {
                    let (id, enabled) = (profile.id.clone(), !profile.enabled);
                    self.preview(
                        RouterCommand::Profile {
                            command: ProfileCommand::Set {
                                id: id.clone(),
                                priority: None,
                                enabled: Some(enabled),
                                name: None,
                            },
                        },
                        format!("Set profile {id} enabled={enabled} / 更新启用状态"),
                    );
                }
            }
            KeyCode::Char(delta @ ('+' | '-')) if self.tab == 0 => {
                if let Some(profile) = self.config.profiles.get(self.selected) {
                    let (id, priority) = (
                        profile.id.clone(),
                        profile
                            .priority
                            .saturating_add(if delta == '+' { 1 } else { -1 }),
                    );
                    self.preview(RouterCommand::Profile {command:ProfileCommand::Set {id:id.clone(),priority:Some(priority),enabled:None,name:None}},format!("Profile {id} priority → {priority}; smaller is preferred / 数值越小越优先"));
                }
            }
            KeyCode::Char('d') if self.tab == 3 => {
                if let Some(route) = self.config.routes.get(self.selected) {
                    let (protocol, model, profile) = (
                        route.protocol,
                        route.model.clone(),
                        route.profile_id.clone(),
                    );
                    self.preview(
                        RouterCommand::Route {
                            command: RouteCommand::Remove {
                                protocol,
                                model: model.clone(),
                                profile: Some(profile),
                            },
                        },
                        format!(
                            "Remove {} / {model} routing rule / 删除路由",
                            protocol.as_str()
                        ),
                    );
                }
            }
            KeyCode::Char(delta @ ('+' | '-')) if self.tab == 3 => {
                if let Some(route) = self.config.routes.get(self.selected) {
                    let route = route.clone();
                    let priority = route
                        .priority
                        .saturating_add(if delta == '+' { 1 } else { -1 });
                    self.preview(
                        RouterCommand::Route {
                            command: RouteCommand::Set {
                                protocol: route.protocol,
                                model: route.model.clone(),
                                profile: route.profile_id,
                                upstream_model: route.upstream_model,
                                priority,
                            },
                        },
                        format!(
                            "Route {} priority → {priority} / 调整路由优先级",
                            route.model
                        ),
                    );
                }
            }
            KeyCode::Enter => match self.tab {
                0 => {
                    self.tab = 2;
                    self.selected = 0;
                }
                1 => {
                    if let Some(token) = self.tokens.get(self.selected) {
                        let (id, name) = (token.id.clone(), token.name.clone());
                        self.preview(RouterCommand::Profile {command:ProfileCommand::Add {token_id:id.clone(),name:Some(name.clone()),priority:self.config.profiles.len() as i32}},format!("Add {name} ({id}), fetch its models, save secret only in OS keychain / 添加令牌配置档"));
                    }
                }
                2 => {
                    if let Some(model) = self.models().get(self.selected).cloned() {
                        if model.starts_with("qys-") {
                            self.notice = "Stack model is already pinned to its profile; no manual route is needed. / Stack 模型已精确绑定配置档，无需手动创建路由".into();
                        } else if let Some(profile) = self.target_profile(&model) {
                            self.preview(
                                RouterCommand::Route {
                                    command: RouteCommand::Set {
                                        protocol: self.protocol(),
                                        model: model.clone(),
                                        profile: profile.clone(),
                                        upstream_model: None,
                                        priority: 0,
                                    },
                                },
                                format!(
                                    "{} / {model} → {profile} / 精确绑定配置档",
                                    self.protocol().as_str()
                                ),
                            );
                        }
                    }
                }
                4 => {
                    let client = CLIENTS[self.selected];
                    if client == ClientKind::ChatgptDesktop {
                        self.notice="ChatGPT Desktop has no verified custom Endpoint adapter; no configuration will be changed. 当前不支持，未修改配置。".into();
                    } else if let Some(model) = self.client_model.clone() {
                        let preview = crate::router::clients::apply(client, Some(&model), true);
                        match preview {
                            Ok(value) => self.preview(
                                RouterCommand::Apply {
                                    client,
                                    model: Some(model),
                                    dry_run: false,
                                },
                                logging::redact(
                                    &serde_json::to_string_pretty(&value).unwrap_or_default(),
                                ),
                            ),
                            Err(e) => {
                                self.notice =
                                    logging::redact(&format!("Cannot prepare client config: {e:#}"))
                            }
                        };
                    } else {
                        self.notice="Open Models, select the protocol/model and press Space first / 先在模型页按空格选定客户端模型".into();
                    }
                }
                _ => {}
            },
            _ => {}
        }
    }
    pub fn render(&self, frame: &mut ratatui::Frame) {
        let [header, tabs, body, footer] = Layout::vertical([
            Constraint::Length(3),
            Constraint::Length(3),
            Constraint::Min(6),
            Constraint::Length(4),
        ])
        .areas(frame.area());
        frame.render_widget(Paragraph::new(format!("Quyan Local Router / 本地路由  {}  |  {}\n固定入口 · 按模型路由 · 热切换 · 不记录提示词",if self.status["running"]==true {"RUNNING 运行中"} else {"STOPPED 已停止"},self.config.base_url())).block(Block::default().borders(Borders::BOTTOM)),header);
        frame.render_widget(
            Tabs::new(TABS.to_vec())
                .select(self.tab)
                .highlight_style(Style::default().fg(Color::Cyan))
                .block(Block::default().borders(Borders::BOTTOM)),
            tabs,
        );
        if self.work.is_some() {
            frame.render_widget(Paragraph::new("Applying confirmed operation… / 正在执行已确认操作

The interface remains responsive; another write or exit is available after this operation finishes. / 操作完成后可继续写入或返回。").wrap(Wrap {trim:false}).block(Block::default().borders(Borders::ALL).title(" Working / 执行中 ")),body);
        } else if let Some(preview) = &self.preview {
            frame.render_widget(Paragraph::new(format!("PREVIEW / 操作预览\n\n{}\n\nConfirm with y; n/Esc cancels. / y 确认，n/Esc 取消",preview.description)).wrap(Wrap {trim:false}).block(Block::default().borders(Borders::ALL).title(" Confirm before writing / 写入确认 ")),body);
        } else if let Some(editor) = &self.alias {
            frame.render_widget(Paragraph::new(format!("Client-facing alias / 客户端别名: {}▏\nUpstream / 实际模型: {}\nProfile / 配置档: {}\n\nType an alias, Enter previews; Esc cancels. / 输入别名后 Enter 预览",editor.input,editor.upstream,editor.profile)).wrap(Wrap {trim:false}).block(Block::default().borders(Borders::ALL)),body);
        } else {
            let [list, details] =
                Layout::horizontal([Constraint::Percentage(42), Constraint::Percentage(58)])
                    .areas(body);
            let items = self
                .rows()
                .into_iter()
                .map(ListItem::new)
                .collect::<Vec<_>>();
            let mut state = ListState::default().with_selected(Some(self.selected));
            frame.render_stateful_widget(
                List::new(items)
                    .highlight_style(Style::default().fg(Color::Black).bg(Color::Cyan))
                    .highlight_symbol("› ")
                    .block(Block::default().borders(Borders::ALL).title(TABS[self.tab])),
                list,
                &mut state,
            );
            let detail=match self.tab {
                0=>self.config.profiles.get(self.selected).map(|p|format!("{}\nID: {}\nRelay Token: {}\nPriority / 优先级: {}\nEnabled / 启用: {}\nModels / 模型: {}\nRefreshed / 刷新: {}\n\nEnter: models | a: add | Space: enable\n+/-: priority | d: remove\n\nSecret stays in OS keychain / 密钥只在系统密钥链",p.name,p.id,p.relay_token_id,p.priority,p.enabled,Protocol::ALL.iter().map(|t|format!("{}:{}",t.as_str(),t.models(&p.models).len())).collect::<Vec<_>>().join(" / "),p.last_models_refresh_at.as_deref().unwrap_or("not refreshed"))).unwrap_or_else(||"No profiles. Press a to choose a Relay Token. / 按 a 添加配置档".into()),
                1=>format!("Relay Token page {} / {} items\n\nEnter: preview adding selected token\nn/b: next/previous page\n\n令牌只显示名称和 ID；不会显示密钥。",self.page,self.total),
                2=>{let model=self.models().get(self.selected).cloned().unwrap_or_default();format!("Protocol / 协议: {}\nModel / 模型: {}\nTarget / 目标: {}\n\np: protocol | t: next compatible profile\nv: toggle Stack model IDs\nEnter: bind | a: create alias\nSpace: select for client setup\n\n候选由令牌可用模型决定；物理渠道仍由 Relay 选择。",self.protocol().as_str(),model,self.target_profile(&model).unwrap_or_else(||"none".into()))},
                3=>self.config.routes.get(self.selected).map(|r|format!("Protocol: {}\nRequested: {}\nUpstream: {}\nProfile: {}\nPriority: {}\n\n+/-: priority | d: remove\n按请求模型、协议绑定到配置档；不发明渠道请求头。",r.protocol.as_str(),r.model,r.upstream_model.as_deref().unwrap_or(&r.model),r.profile_id,r.priority)).unwrap_or_else(||"No explicit routes; compatible profiles are chosen automatically. / 目前使用自动模型匹配。".into()),
                4=>format!("Client / 客户端: {}\nSelected model / 已选模型: {}\n\nm: choose model\nEnter: preview config + backups\n\nClaude Desktop uses its own 3P profile.\n首次接入可能需要重启，之后路由变更无需重启。\nChatGPT Desktop 不做证书劫持。",CLIENTS[self.selected].id(),self.client_model.as_deref().unwrap_or("choose on Models tab")),
                _=>serde_json::to_string_pretty(&self.status).unwrap_or_default(),
            };
            frame.render_widget(
                Paragraph::new(detail).wrap(Wrap { trim: false }).block(
                    Block::default()
                        .borders(Borders::ALL)
                        .title(" Details / 详情 "),
                ),
                details,
            );
        }
        frame.render_widget(Paragraph::new(format!("Tab/Shift-Tab: page | ↑↓: select | r: refresh | s: start | x: stop | f: refresh models | Esc: back\n{}",self.notice)).wrap(Wrap {trim:false}).block(Block::default().borders(Borders::TOP)),footer);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_pending_mutation_is_a_preview_not_an_execution() {
        let mut view = RouterView::default();
        view.preview(RouterCommand::Stop, "Stop Router".into());
        assert!(view.modal());
        assert!(view.config.profiles.is_empty());
    }
    #[test]
    fn narrow_workspace_and_confirmation_render_without_secrets() {
        let mut term = ratatui::Terminal::new(ratatui::backend::TestBackend::new(80, 24)).unwrap();
        let mut view = RouterView::default();
        view.preview(RouterCommand::Start, "Start loopback Router".into());
        term.draw(|frame| view.render(frame)).unwrap();
        let output = format!("{:?}", term.backend().buffer());
        assert!(output.contains("Start loopback Router"));
        assert!(!output.contains("rlt_"));
    }
}

impl Drop for RouterView {
    fn drop(&mut self) {
        if let Some(task) = self.token_work.take() {
            task.abort();
        }
        if let Some(task) = self.poll_task.take() {
            task.abort();
        }
    }
}

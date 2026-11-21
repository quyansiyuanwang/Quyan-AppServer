//! Customer-owned local profiles and routing. Platform channels are never edited here.
use super::ui::{self, Theme};
use crate::{
    core::api::ApiClient,
    features::integrations::ClientKind,
    router::{
        commands::{ProfileCommand, RouteCommand, RouterCommand, StackCommand},
        config::{self, RouterConfig},
        routing::{self, Protocol},
    },
};
use crossterm::event::KeyCode;
use ratatui::{
    layout::{Constraint, Layout},
    widgets::{Paragraph, Tabs},
};
use serde_json::{json, Value};
use std::time::Instant;
use tokio::task::JoinHandle;

const STATUS_INTERVAL: std::time::Duration = std::time::Duration::from_secs(3);
struct Pending {
    command: RouterCommand,
    summary: String,
}
struct Alias {
    text: String,
    model: String,
    profile: String,
}
pub(super) struct RouterView {
    theme: Theme,
    tab: usize,
    selected: [usize; 6],
    protocol: usize,
    target: usize,
    query: String,
    search: bool,
    detail: bool,
    scroll: u16,
    config: RouterConfig,
    status: Value,
    tokens: Vec<(String, String)>,
    page: u64,
    total: u64,
    client_model: Option<String>,
    pub client_request: Option<(ClientKind, Option<String>)>,
    alias: Option<Alias>,
    pending: Option<Pending>,
    notice: String,
    snapshot: Option<JoinHandle<anyhow::Result<(RouterConfig, Value)>>>,
    token_task: Option<JoinHandle<anyhow::Result<Value>>>,
    write: Option<JoinHandle<anyhow::Result<Option<Value>>>>,
    active: bool,
    last_poll: Instant,
}
impl RouterView {
    pub fn new(theme: Theme) -> Self {
        Self {
            theme,
            tab: 0,
            selected: [0; 6],
            protocol: 0,
            target: 0,
            query: String::new(),
            search: false,
            detail: false,
            scroll: 0,
            config: RouterConfig::default(),
            status: Value::Null,
            tokens: vec![],
            page: 1,
            total: 0,
            client_model: None,
            client_request: None,
            alias: None,
            pending: None,
            notice: String::new(),
            snapshot: None,
            token_task: None,
            write: None,
            active: false,
            last_poll: Instant::now(),
        }
    }
    pub fn busy(&self) -> bool {
        self.write.is_some()
    }
    pub fn captures(&self) -> bool {
        self.search || self.alias.is_some() || self.pending.is_some()
    }
    fn tabs(&self) -> [&str; 6] {
        [
            self.theme.t("配置档", "Profiles"),
            self.theme.t("令牌", "Tokens"),
            self.theme.t("模型", "Models"),
            self.theme.t("路由", "Routes"),
            self.theme.t("客户端", "Clients"),
            self.theme.t("状态", "Status"),
        ]
    }
    fn protocol(&self) -> Protocol {
        Protocol::ALL[self.protocol]
    }
    fn models(&self) -> Vec<String> {
        routing::aggregate_models(&self.config, self.protocol())
    }
    fn all_rows(&self) -> Vec<String> {
        match self.tab {
            0 => self
                .config
                .profiles
                .iter()
                .map(|p| {
                    format!(
                        "{} {}  {}",
                        if p.enabled { "●" } else { "○" },
                        p.name,
                        p.priority
                    )
                })
                .collect(),
            1 => self.tokens.iter().map(|(_, name)| name.clone()).collect(),
            2 => self.models(),
            3 => self
                .config
                .routes
                .iter()
                .map(|r| {
                    format!(
                        "{}  {} → {}",
                        r.protocol.as_str(),
                        r.model,
                        self.config
                            .profiles
                            .iter()
                            .find(|p| p.id == r.profile_id)
                            .map(|p| p.name.as_str())
                            .unwrap_or(&r.profile_id)
                    )
                })
                .collect(),
            4 => ClientKind::configurable()
                .iter()
                .map(|client| client.id())
                .collect(),
            _ => vec![
                format!(
                    "{}  {}",
                    self.theme.t("运行", "Running"),
                    self.status["running"] == true
                ),
                format!("Stack  {}", self.config.stack_enabled),
            ],
        }
    }
    fn indices(&self) -> Vec<usize> {
        let query = self.query.to_lowercase();
        self.all_rows()
            .iter()
            .enumerate()
            .filter(|(_, row)| row.to_lowercase().contains(&query))
            .map(|(i, _)| i)
            .collect()
    }
    fn index(&self) -> Option<usize> {
        self.indices().get(self.selected[self.tab]).copied()
    }
    fn selected_model(&self) -> Option<String> {
        self.index().and_then(|i| self.models().get(i).cloned())
    }
    fn target_candidate(&self, model: &str) -> Option<routing::Candidate> {
        let choices = routing::candidates(&self.config, self.protocol(), model);
        choices.get(self.target % choices.len().max(1)).cloned()
    }
    fn target_profile(&self, model: &str) -> Option<String> {
        self.target_candidate(model).map(|c| c.profile_id)
    }
    fn switch_tab(&mut self, tab: usize) {
        self.tab = tab;
        self.query.clear();
        self.detail = false;
        self.scroll = 0;
    }
    pub fn refresh(&mut self) {
        if let Some(task) = self.snapshot.take() {
            task.abort();
        }
        self.active = true;
        self.last_poll = Instant::now();
        self.notice = self.theme.t("加载中…", "Loading…").into();
        self.snapshot = Some(tokio::spawn(async {
            let config = tokio::task::spawn_blocking(config::load).await??;
            let status = crate::router::process::status().await?;
            Ok((config, status))
        }));
    }
    fn load_tokens(&mut self, api: &ApiClient) {
        if let Some(task) = self.token_task.take() {
            task.abort();
        }
        let api = api.clone();
        let page = self.page;
        self.notice = self.theme.t("加载令牌…", "Loading tokens…").into();
        self.token_task = Some(tokio::spawn(async move {
            crate::services::relay::tokens_page(&api, page).await
        }));
    }
    pub async fn poll(&mut self) {
        if self.snapshot.as_ref().is_some_and(JoinHandle::is_finished) {
            match self.snapshot.take().unwrap().await {
                Ok(Ok((config, status))) => {
                    self.config = config;
                    self.status = status;
                    if self.notice == self.theme.t("加载中…", "Loading…") {
                        self.notice.clear();
                    }
                }
                Ok(Err(error)) => self.notice = ui::error(&error),
                Err(_) => self.notice = self.theme.t("状态读取失败", "Status unavailable").into(),
            }
        }
        if self
            .token_task
            .as_ref()
            .is_some_and(JoinHandle::is_finished)
        {
            match self.token_task.take().unwrap().await {
                Ok(Ok(value)) => {
                    self.total = value["total"].as_u64().unwrap_or(0);
                    self.tokens = value["items"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|v| {
                            Some((
                                v["id"].as_str()?.to_string(),
                                ui::safe(v["name"].as_str().unwrap_or("—")),
                            ))
                        })
                        .collect();
                    self.notice.clear();
                }
                Ok(Err(error)) => self.notice = ui::error(&error),
                Err(_) => self.notice = self.theme.t("令牌读取失败", "Token load failed").into(),
            }
        }
        if self.write.as_ref().is_some_and(JoinHandle::is_finished) {
            match self.write.take().unwrap().await {
                Ok(Ok(_)) => {
                    self.refresh();
                    self.notice = self.theme.t("已完成", "Done").into();
                }
                Ok(Err(error)) => self.notice = ui::error(&error),
                Err(_) => {
                    self.notice = self
                        .theme
                        .t("操作失败，请刷新", "Operation failed; refresh")
                        .into()
                }
            }
        }
        for tab in 0..6 {
            if tab == self.tab {
                self.selected[tab] = self.selected[tab].min(self.indices().len().saturating_sub(1));
            }
        }
        if self.active
            && self.snapshot.is_none()
            && self.write.is_none()
            && self.last_poll.elapsed() >= STATUS_INTERVAL
        {
            self.last_poll = Instant::now();
            self.snapshot = Some(tokio::spawn(async {
                Ok((
                    tokio::task::spawn_blocking(config::load).await??,
                    crate::router::process::status().await?,
                ))
            }));
        }
    }
    fn preview(&mut self, command: RouterCommand, summary: String) {
        if !self.busy() {
            self.pending = Some(Pending { command, summary });
            self.scroll = 0;
        }
    }
    pub fn key(&mut self, key: KeyCode, api: &ApiClient, width: u16, height: u16) -> bool {
        if self.search {
            match key {
                KeyCode::Esc | KeyCode::Enter => self.search = false,
                KeyCode::Backspace => {
                    self.query.pop();
                    self.selected[self.tab] = 0;
                }
                KeyCode::Char(ch) if !ch.is_control() => {
                    self.query.push(ch);
                    self.selected[self.tab] = 0;
                }
                _ => {}
            }
            return false;
        }
        if let Some(alias) = &mut self.alias {
            match key {
                KeyCode::Esc => self.alias = None,
                KeyCode::Backspace => {
                    alias.text.pop();
                }
                KeyCode::Char(ch) if !ch.is_control() && alias.text.len() < 256 => {
                    alias.text.push(ch)
                }
                KeyCode::Enter if !alias.text.trim().is_empty() => {
                    let alias = self.alias.take().unwrap();
                    self.preview(
                        RouterCommand::Route {
                            command: RouteCommand::Set {
                                protocol: self.protocol(),
                                model: alias.text.trim().into(),
                                profile: alias.profile.clone(),
                                upstream_model: Some(alias.model.clone()),
                                priority: 0,
                            },
                        },
                        format!("{} → {}\n{}", alias.text.trim(), alias.model, alias.profile),
                    );
                }
                _ => {}
            }
            return false;
        }
        if self.pending.is_some() {
            match key {
                KeyCode::Char('y') if !self.busy() => {
                    let pending = self.pending.take().unwrap();
                    let locale = self.theme.locale.clone();
                    self.notice = self.theme.t("执行中…", "Applying…").into();
                    self.write = Some(tokio::spawn(async move {
                        let mut config =
                            tokio::task::spawn_blocking(crate::core::config::load).await??;
                        config.locale = locale;
                        crate::router::commands::run(pending.command, true, &config).await
                    }));
                }
                KeyCode::Char('n') | KeyCode::Esc | KeyCode::Enter => self.pending = None,
                _ => {}
            }
            return false;
        }
        if self.detail {
            if key == KeyCode::Esc {
                self.detail = false;
                self.scroll = 0;
                return false;
            }
            let details = self.details();
            if ui::text_scroll(
                key,
                &mut self.scroll,
                &details,
                if width >= 92 { width * 58 / 100 } else { width },
                height.saturating_sub(2),
            ) {
                return false;
            }
        }
        if key == KeyCode::Esc {
            return true;
        }
        if key == KeyCode::Tab {
            self.switch_tab((self.tab + 1) % 6);
            if self.tab == 1 {
                self.load_tokens(api);
            }
            return false;
        }
        if key == KeyCode::BackTab {
            self.switch_tab((self.tab + 5) % 6);
            return false;
        }
        if key == KeyCode::Char('/') {
            self.search = true;
            return false;
        }
        let len = self.indices().len();
        if ui::navigate(key, &mut self.selected[self.tab], len, height) {
            self.scroll = 0;
            return false;
        }
        if key == KeyCode::Char('r') {
            self.refresh();
            if self.tab == 1 {
                self.load_tokens(api);
            }
            return false;
        }
        if self.busy() {
            return false;
        }
        match key {
            KeyCode::Char('s') => self.preview(
                RouterCommand::Start,
                self.theme.t("启动本地路由", "Start local Router").into(),
            ),
            KeyCode::Char('x') => self.preview(
                RouterCommand::Stop,
                self.theme
                    .t(
                        "停止本地路由 · 中断客户端连接",
                        "Stop local Router · clients will disconnect",
                    )
                    .into(),
            ),
            KeyCode::Char('f') => self.preview(
                RouterCommand::Models { refresh: true },
                self.theme
                    .t("刷新配置档模型目录", "Refresh profile model catalogs")
                    .into(),
            ),
            KeyCode::Char('v') => self.preview(
                RouterCommand::Stack {
                    command: if self.config.stack_enabled {
                        StackCommand::Disable
                    } else {
                        StackCommand::Enable
                    },
                },
                format!("Stack → {}", !self.config.stack_enabled),
            ),
            _ => self.tab_key(key, api),
        }
        false
    }
    fn tab_key(&mut self, key: KeyCode, api: &ApiClient) {
        let index = self.index();
        match self.tab {
            0 => {
                if key == KeyCode::Char('a') {
                    self.switch_tab(1);
                    self.load_tokens(api);
                    return;
                }
                let Some(profile) = index.and_then(|i| self.config.profiles.get(i)).cloned() else {
                    return;
                };
                match key {
                    KeyCode::Char('d') => self.preview(
                        RouterCommand::Profile {
                            command: ProfileCommand::Remove {
                                id: profile.id.clone(),
                            },
                        },
                        format!(
                            "{} {}\n{}",
                            self.theme.t("移除", "Remove"),
                            profile.name,
                            profile.id
                        ),
                    ),
                    KeyCode::Char(' ') => self.preview(
                        RouterCommand::Profile {
                            command: ProfileCommand::Set {
                                id: profile.id.clone(),
                                priority: None,
                                enabled: Some(!profile.enabled),
                                name: None,
                            },
                        },
                        format!("{} → {}", profile.name, !profile.enabled),
                    ),
                    KeyCode::Char('+') | KeyCode::Char('-') => {
                        let priority = if key == KeyCode::Char('+') {
                            profile.priority.saturating_add(1)
                        } else {
                            profile.priority.saturating_sub(1)
                        };
                        self.preview(
                            RouterCommand::Profile {
                                command: ProfileCommand::Set {
                                    id: profile.id.clone(),
                                    priority: Some(priority),
                                    enabled: None,
                                    name: None,
                                },
                            },
                            format!(
                                "{}  {} → {priority}",
                                profile.name,
                                self.theme.t("优先级", "Priority")
                            ),
                        );
                    }
                    KeyCode::Enter => {
                        self.detail = true;
                        self.scroll = 0;
                    }
                    _ => {}
                }
            }
            1 => match key {
                KeyCode::Left if self.page > 1 => {
                    self.page -= 1;
                    self.load_tokens(api);
                }
                KeyCode::Right
                    if self.page * crate::services::relay::TOKEN_PAGE_SIZE < self.total =>
                {
                    self.page += 1;
                    self.load_tokens(api);
                }
                KeyCode::Enter => {
                    if let Some((id, name)) = index.and_then(|i| self.tokens.get(i)).cloned() {
                        self.preview(
                            RouterCommand::Profile {
                                command: ProfileCommand::Add {
                                    token_id: id.clone(),
                                    name: Some(name.clone()),
                                    priority: 0,
                                },
                            },
                            format!("{} {name}\n{id}", self.theme.t("添加配置档", "Add profile")),
                        );
                    }
                }
                _ => {}
            },
            2 => {
                if key == KeyCode::Char('p') {
                    self.protocol = (self.protocol + 1) % Protocol::ALL.len();
                    self.selected[2] = 0;
                    self.target = 0;
                    return;
                }
                if key == KeyCode::Char('t') {
                    self.target = self.target.saturating_add(1);
                    return;
                }
                let Some(model) = self.selected_model() else {
                    return;
                };
                match key {
                    KeyCode::Char(' ') => {
                        self.client_model = Some(model);
                        self.switch_tab(4);
                    }
                    KeyCode::Char('a') => {
                        if let Some(candidate) = self.target_candidate(&model) {
                            self.alias = Some(Alias {
                                text: String::new(),
                                model: candidate.model,
                                profile: candidate.profile_id,
                            });
                        }
                    }
                    KeyCode::Enter => {
                        if let Some(candidate) = self.target_candidate(&model) {
                            let profile = candidate.profile_id;
                            let upstream_model =
                                (candidate.model != model).then_some(candidate.model);
                            self.preview(
                                RouterCommand::Route {
                                    command: RouteCommand::Set {
                                        protocol: self.protocol(),
                                        model: model.clone(),
                                        profile: profile.clone(),
                                        upstream_model,
                                        priority: 0,
                                    },
                                },
                                format!("{}\n{model} → {profile}", self.protocol().as_str()),
                            );
                        }
                    }
                    _ => {}
                }
            }
            3 => {
                let Some(route) = index.and_then(|i| self.config.routes.get(i)).cloned() else {
                    return;
                };
                match key {
                    KeyCode::Char('d') => self.preview(
                        RouterCommand::Route {
                            command: RouteCommand::Remove {
                                protocol: route.protocol,
                                model: route.model.clone(),
                                profile: Some(route.profile_id.clone()),
                            },
                        },
                        format!(
                            "{} {}\n{}",
                            self.theme.t("删除路由", "Remove route"),
                            route.model,
                            route.profile_id
                        ),
                    ),
                    KeyCode::Char('+') | KeyCode::Char('-') => {
                        let priority = if key == KeyCode::Char('+') {
                            route.priority.saturating_add(1)
                        } else {
                            route.priority.saturating_sub(1)
                        };
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
                                "{}  {} → {priority}",
                                route.model,
                                self.theme.t("优先级", "Priority")
                            ),
                        );
                    }
                    KeyCode::Enter => {
                        self.detail = true;
                        self.scroll = 0;
                    }
                    _ => {}
                }
            }
            4 => {
                if key == KeyCode::Char('m') {
                    self.switch_tab(2);
                    return;
                }
                if key == KeyCode::Enter {
                    if let Some(client) =
                        index.and_then(|i| ClientKind::configurable().get(i).copied())
                    {
                        self.client_request = Some((client, self.client_model.clone()));
                    }
                }
            }
            _ => {
                if key == KeyCode::Enter {
                    self.detail = true;
                    self.scroll = 0;
                }
            }
        }
    }
    fn details(&self) -> String {
        let index = self.index();
        match self.tab{
            0=>index.and_then(|i|self.config.profiles.get(i)).map(|p|crate::utils::output::human(&json!({"name":p.name,"id":p.id,"enabled":p.enabled,"priority":p.priority,"models":Protocol::ALL.iter().map(|protocol|(protocol.as_str().to_string(),json!(protocol.models(&p.models).len()))).collect::<serde_json::Map<_,_>>()}),&self.theme.locale)).unwrap_or_default(),
            1=>index.and_then(|i|self.tokens.get(i)).map(|(id,name)|format!("{name}\nID  {id}\n{} {} / {}",self.theme.t("页码","Page"),self.page,self.total)).unwrap_or_default(),
            2=>{
                let model=self.selected_model().unwrap_or_default();let target=self.target_profile(&model).unwrap_or_else(||"—".into());
                format!("{}\n{model}\n\n{}  {}\nStack  {}",self.protocol().as_str(),self.theme.t("目标","Target"),self.config.profiles.iter().find(|p|p.id==target).map(|p|p.name.as_str()).unwrap_or(&target),self.config.stack_enabled)
            }
            3=>index.and_then(|i|self.config.routes.get(i)).map(|r|format!("{}\n{} → {}\n{}\n{}  {}",r.protocol.as_str(),r.model,r.upstream_model.as_deref().unwrap_or(&r.model),r.profile_id,self.theme.t("优先级","Priority"),r.priority)).unwrap_or_default(),
            4=>format!("{}\n{}  {}",index.and_then(|i|ClientKind::configurable().get(i).copied()).map(|c|c.id()).unwrap_or_default(),self.theme.t("模型","Model"),self.client_model.as_deref().unwrap_or("—")),
            _=>crate::utils::output::human(&self.status,&self.theme.locale),
        }
    }
    pub fn render(&self, frame: &mut ratatui::Frame) {
        let title = format!(
            "{}  {}",
            self.theme.t("本地路由", "Local Router"),
            if self.status["running"] == true {
                "●"
            } else {
                "○"
            }
        );
        let keys = if self.pending.is_some() {
            self.theme
                .t("y 确认  n/Esc 取消", "y confirm  n/Esc cancel")
        } else if self.search || self.alias.is_some() {
            self.theme.t("Enter 完成  Esc 返回", "Enter done  Esc back")
        } else {
            self.theme.t(
                "Tab 切页  / 搜索  Enter 打开  ? 帮助  Esc 返回",
                "Tab page  / search  Enter open  ? help  Esc back",
            )
        };
        let body = ui::shell(frame, &title, &self.notice, keys, &self.theme);
        let [tabs, filter, area] = Layout::vertical([
            Constraint::Length(1),
            Constraint::Length(1),
            Constraint::Min(1),
        ])
        .areas(body);
        // Compact terminals show the active tab; Tab still reaches every page.
        if body.width >= 70 {
            frame.render_widget(
                Tabs::new(self.tabs().to_vec())
                    .select(self.tab)
                    .highlight_style(self.theme.accent())
                    .divider(" "),
                tabs,
            );
        } else {
            frame.render_widget(
                Paragraph::new(format!("‹ {} ›", self.tabs()[self.tab])).style(self.theme.accent()),
                tabs,
            );
        }
        frame.render_widget(
            Paragraph::new(if self.search || !self.query.is_empty() {
                format!("/ {}{}", self.query, if self.search { "▏" } else { "" })
            } else {
                self.config.base_url()
            }),
            filter,
        );
        if let Some(pending) = &self.pending {
            ui::text(
                frame,
                area,
                self.theme.t("确认", "Confirm"),
                &pending.summary,
                self.scroll,
            );
            return;
        }
        if let Some(alias) = &self.alias {
            ui::text(
                frame,
                area,
                self.theme.t("模型别名", "Model alias"),
                &format!("{}▏\n→ {}\n{}", alias.text, alias.model, alias.profile),
                0,
            );
            return;
        }
        let rows = self.all_rows();
        let filtered = self
            .indices()
            .into_iter()
            .filter_map(|i| rows.get(i).cloned())
            .collect::<Vec<_>>();
        let filtered = if filtered.is_empty() {
            vec![self.theme.t("暂无结果", "No results").into()]
        } else {
            filtered
        };
        if area.width < 92 && self.detail {
            ui::text(
                frame,
                area,
                self.tabs()[self.tab],
                &self.details(),
                self.scroll,
            );
        } else if area.width >= 92 {
            let [list, detail] =
                Layout::horizontal([Constraint::Percentage(42), Constraint::Percentage(58)])
                    .areas(area);
            ui::list(
                frame,
                list,
                self.tabs()[self.tab],
                filtered,
                self.selected[self.tab],
                &self.theme,
            );
            ui::text(
                frame,
                detail,
                self.theme.t("详情", "Details"),
                &self.details(),
                self.scroll,
            );
        } else {
            ui::list(
                frame,
                area,
                self.tabs()[self.tab],
                filtered,
                self.selected[self.tab],
                &self.theme,
            );
        }
    }
    pub fn help(&self) -> String {
        self.theme.t("Tab / Shift+Tab  切换页签\ns / x  启动 / 停止\nf  刷新模型目录\nv  切换 Stack\n配置档：a 添加 · Space 启停 · +/- 优先级 · d 移除\n令牌：Enter 添加配置档 · ←→ 翻页\n模型：p 协议 · t 目标 · Enter 绑定 · a 别名 · Space 选用\n路由：+/- 优先级 · d 删除\n客户端：m 选择模型 · Enter 配置","Tab / Shift+Tab  tabs\ns / x  start / stop\nf  refresh catalogs\nv  toggle Stack\nProfiles: a add · Space enable · +/- priority · d remove\nTokens: Enter add profile · ←→ pages\nModels: p protocol · t target · Enter bind · a alias · Space select\nRoutes: +/- priority · d remove\nClients: m select model · Enter configure").into()
    }
}
impl Drop for RouterView {
    fn drop(&mut self) {
        if let Some(task) = self.snapshot.take() {
            task.abort();
        }
        if let Some(task) = self.token_task.take() {
            task.abort();
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stack_bindings_and_aliases_keep_the_original_upstream_model() {
        let mut view = RouterView::new(Theme {
            locale: "en-US".into(),
            no_color: true,
        });
        view.config.stack_enabled = true;
        view.config.profiles.push(config::RouterProfile {
            id: "fixture".into(),
            name: "Fixture".into(),
            relay_token_id: "fixture-token".into(),
            stack_key: "fixture".into(),
            relay_base_url: "https://relay.example.test".into(),
            enabled: true,
            priority: 0,
            models: config::RouterModels {
                openai: vec!["upstream-model".into()],
                ..Default::default()
            },
            last_models_refresh_at: None,
        });
        view.tab = 2;
        let model = routing::stack_model_id(Protocol::Openai, "fixture", "upstream-model");
        view.selected[2] = view
            .models()
            .iter()
            .position(|item| item == &model)
            .unwrap();
        let api = ApiClient::with_endpoints(
            Default::default(),
            "en-US",
            "http://127.0.0.1:1",
            "http://127.0.0.1:1",
        )
        .unwrap();
        view.tab_key(KeyCode::Enter, &api);
        let pending = view.pending.take().unwrap();
        match pending.command {
            RouterCommand::Route {
                command:
                    RouteCommand::Set {
                        model: selected,
                        upstream_model,
                        profile,
                        ..
                    },
            } => {
                assert_eq!(selected, model);
                assert_eq!(upstream_model.as_deref(), Some("upstream-model"));
                assert_eq!(profile, "fixture");
            }
            _ => panic!("expected a route preview"),
        }
        view.tab_key(KeyCode::Char('a'), &api);
        assert_eq!(view.alias.as_ref().unwrap().model, "upstream-model");
    }
    #[test]
    fn customer_router_has_three_clients_and_explicit_mutation_preview() {
        let mut view = RouterView::new(Theme {
            locale: "en-US".into(),
            no_color: true,
        });
        view.preview(RouterCommand::Stop, "Stop local Router".into());
        assert!(view.captures());
        assert!(!view.busy());
        assert_eq!(ClientKind::configurable().len(), 3);
        for (width, height) in [(120, 36), (80, 24), (60, 20)] {
            let mut term =
                ratatui::Terminal::new(ratatui::backend::TestBackend::new(width, height)).unwrap();
            term.draw(|frame| view.render(frame)).unwrap();
            let output = format!("{:?}", term.backend().buffer());
            assert!(output.contains("Stop local Router"));
            assert!(!output.contains("sk-rlt-"));
        }
    }
}

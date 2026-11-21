mod client_setup;
mod relay_screen;
mod router_screen;
mod ui;

use crate::{
    cli::handlers::auth,
    core::{api::ApiClient, branding::QUYAN_BANNER, credentials::Credentials},
    services::{account, json_endpoint_product},
    utils::logging::EventBuffer,
};
use anyhow::Result;
use crossterm::{
    cursor::{Hide, Show},
    event::{self, Event, KeyCode, KeyEventKind, KeyModifiers},
    execute,
    terminal::{
        disable_raw_mode, enable_raw_mode, Clear, ClearType, EnterAlternateScreen,
        LeaveAlternateScreen,
    },
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Layout},
    widgets::Paragraph,
    Terminal,
};
use serde_json::Value;
use std::{
    io::{stdout, IsTerminal},
    time::Instant,
};
use tokio::task::JoinHandle;
use ui::Theme;

pub struct StatusView<'a> {
    pub api_base_url: &'a str,
    pub relay_base_url: &'a str,
    pub auth_base_url: &'a str,
    pub locale: &'a str,
    pub no_color: bool,
    pub config_path: &'a str,
    pub log_path: &'a str,
    pub account_configured: bool,
    pub relay_configured: bool,
    pub product_configured: bool,
    pub events: &'a EventBuffer,
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Screen {
    Home,
    Account,
    Relay,
    Clients,
    Product,
    Diagnostics,
    Router,
    Login,
}
const HOME: [Screen; 7] = [
    Screen::Login,
    Screen::Account,
    Screen::Relay,
    Screen::Clients,
    Screen::Product,
    Screen::Diagnostics,
    Screen::Router,
];
fn labels(theme: &Theme) -> [&str; 7] {
    [
        theme.t("登录", "Sign in"),
        theme.t("账户", "Account"),
        theme.t("AI 中转", "AI Relay"),
        theme.t("AI 客户端", "AI clients"),
        "JSON Endpoints",
        theme.t("诊断", "Diagnostics"),
        theme.t("本地路由", "Local Router"),
    ]
}
struct Login {
    started: Instant,
    task: JoinHandle<Result<Credentials>>,
}
#[derive(Default)]
struct Section {
    content: String,
    task: Option<JoinHandle<Result<Value>>>,
}
impl Section {
    async fn poll(&mut self, theme: &Theme) {
        if !self.task.as_ref().is_some_and(JoinHandle::is_finished) {
            return;
        }
        self.content = match self.task.take().unwrap().await {
            Ok(Ok(value)) => crate::utils::output::human(&value, &theme.locale),
            Ok(Err(error)) => ui::error(&error),
            Err(_) => theme.t("加载失败", "Load failed").into(),
        };
    }
}
impl Drop for Section {
    fn drop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}
struct App {
    screen: Screen,
    selected: usize,
    theme: Theme,
    notice: String,
    help: Option<u16>,
    scroll: u16,
    account: [Section; 3],
    product: Section,
    relay: relay_screen::RelayView,
    clients: client_setup::ClientSetup,
    router: router_screen::RouterView,
    login: Option<Login>,
    quit: bool,
}
impl App {
    fn new(status: &StatusView<'_>) -> Self {
        let theme = Theme {
            locale: status.locale.into(),
            no_color: status.no_color,
        };
        Self {
            screen: Screen::Home,
            selected: 0,
            theme: theme.clone(),
            notice: String::new(),
            help: None,
            scroll: 0,
            account: std::array::from_fn(|_| Section::default()),
            product: Section::default(),
            relay: Default::default(),
            clients: client_setup::ClientSetup::new(theme.clone()),
            router: router_screen::RouterView::new(theme),
            login: None,
            quit: false,
        }
    }
    fn busy(&self) -> bool {
        self.relay.busy() || self.clients.busy() || self.router.busy()
    }
    fn captures(&self) -> bool {
        match self.screen {
            Screen::Relay => self.relay.captures(),
            Screen::Clients => self.clients.captures(),
            Screen::Router => self.router.captures(),
            _ => false,
        }
    }
    fn open(&mut self, screen: Screen, api: &ApiClient, status: &StatusView<'_>) {
        if screen == Screen::Login && self.busy() {
            self.notice = self
                .theme
                .t("请等待操作完成", "Wait for the current operation")
                .into();
            return;
        }
        self.screen = screen;
        self.scroll = 0;
        match screen {
            Screen::Account => self.load_account(api),
            Screen::Relay => self.relay.refresh(api, &self.theme),
            Screen::Clients => self.clients.refresh(api),
            Screen::Router => self.router.refresh(),
            Screen::Product => self.load_product(api),
            Screen::Login => {
                let api_base = api.api_base_url.clone();
                let auth_base = status.auth_base_url.to_string();
                self.login = Some(Login {
                    started: Instant::now(),
                    task: tokio::spawn(async move {
                        let session = auth::begin_browser_login(&api_base, &auth_base).await?;
                        auth::complete_browser_login(session).await
                    }),
                });
            }
            _ => {}
        }
    }
    fn load_account(&mut self, api: &ApiClient) {
        for section in &mut self.account {
            if let Some(task) = section.task.take() {
                task.abort();
            }
            section.content = self.theme.t("加载中…", "Loading…").into();
        }
        let client = api.clone();
        self.account[0].task = Some(tokio::spawn(async move {
            let profile = account::profile(&client).await?;
            let keys = ["username", "nickname", "email"];
            let fields = keys
                .into_iter()
                .filter_map(|key| profile.get(key).map(|v| (key.to_string(), v.clone())))
                .collect::<serde_json::Map<_, _>>();
            Ok(Value::Object(fields))
        }));
        let client = api.clone();
        self.account[1].task = Some(tokio::spawn(async move { account::balance(&client).await }));
        let client = api.clone();
        self.account[2].task = Some(tokio::spawn(async move { account::usage(&client).await }));
    }
    fn load_product(&mut self, api: &ApiClient) {
        if let Some(task) = self.product.task.take() {
            task.abort();
        }
        let api = api.clone();
        self.product.content = self.theme.t("加载中…", "Loading…").into();
        self.product.task = Some(tokio::spawn(async move {
            json_endpoint_product::get(&api).await
        }));
    }
    fn diagnostics(&self, status: &StatusView<'_>) -> String {
        format!(
            "API  {}\nRelay  {}\nAuth  {}\nConfig  {}\nLog  {}\n\n{}",
            status.api_base_url,
            status.relay_base_url,
            status.auth_base_url,
            status.config_path,
            status.log_path,
            status.events.entries().join("\n")
        )
    }
    fn account_text(&self) -> String {
        [
            self.theme.t("账户", "Account"),
            self.theme.t("余额", "Balance"),
            self.theme.t("用量", "Usage"),
        ]
        .into_iter()
        .zip(&self.account)
        .map(|(title, section)| format!("{title}\n{}", section.content))
        .collect::<Vec<_>>()
        .join("\n\n")
    }
    async fn poll(&mut self, api: &mut ApiClient, status: &mut StatusView<'_>) {
        for section in &mut self.account {
            section.poll(&self.theme).await;
        }
        if self
            .product
            .task
            .as_ref()
            .is_some_and(JoinHandle::is_finished)
        {
            self.product.content = match self.product.task.take().unwrap().await {
                Ok(Ok(value)) => serde_json::to_string_pretty(&value).unwrap_or_default(),
                Ok(Err(error)) => ui::error(&error),
                Err(_) => self.theme.t("加载失败", "Load failed").into(),
            };
        }
        self.relay.poll(api, &self.theme).await;
        if let Some(credentials) = self.relay.credentials.take() {
            api.credentials = credentials;
        }
        self.clients.poll().await;
        self.router.poll().await;
        if let Some((client, model)) = self.router.client_request.take() {
            self.clients.select_router(client, model, api);
            self.screen = Screen::Clients;
        }
        if self
            .login
            .as_ref()
            .is_some_and(|login| login.task.is_finished())
        {
            let login = self.login.take().unwrap();
            self.notice = match login.task.await {
                Ok(Ok(credentials)) => {
                    api.credentials = credentials;
                    self.theme.t("已登录", "Signed in").into()
                }
                Ok(Err(error)) => ui::error(&error),
                Err(_) => self.theme.t("登录失败", "Sign in failed").into(),
            };
            self.screen = Screen::Home;
        }
        status.account_configured =
            api.credentials.access_token.is_some() || api.credentials.access_key.is_some();
        status.relay_configured = api.credentials.relay_token.is_some();
        status.product_configured = api.credentials.product_key.is_some();
    }
    fn help_text(&self) -> String {
        let common=self.theme.t("↑↓ / j k  移动\nEnter  打开\nHome / End  首尾\nPgUp / PgDn  翻页\nr  刷新\nEsc  返回\nq / Ctrl+C  退出","↑↓ / j k  move\nEnter  open\nHome / End  first / last\nPgUp / PgDn  page\nr  refresh\nEsc  back\nq / Ctrl+C  quit");
        let extra = match self.screen {
            Screen::Home => format!(
                "{QUYAN_BANNER}\n{}\n1–7  {}",
                env!("CARGO_PKG_VERSION"),
                self.theme.t("直接打开", "open directly")
            ),
            Screen::Relay => self
                .theme
                .t(
                    "/  搜索全部令牌\nc  新建\ne  重命名\nu  选用\nd  删除\n← →  切页",
                    "/  search all tokens\nc  create\ne  rename\nu  use\nd  delete\n← →  pages",
                )
                .into(),
            Screen::Clients => self.clients.help(),
            Screen::Router => self.router.help(),
            _ => String::new(),
        };
        format!("{extra}\n\n{common}")
    }
    fn render(&self, frame: &mut ratatui::Frame, status: &StatusView<'_>) {
        if let Some(offset) = self.help {
            ui::help(frame, &self.help_text(), offset, &self.theme);
            return;
        }
        match self.screen {
            Screen::Home => {
                let summary = format!(
                    "{} {}  ·  Relay {}  ·  JSON {}",
                    self.theme.t("账户", "Account"),
                    if status.account_configured {
                        "●"
                    } else {
                        "○"
                    },
                    if status.relay_configured {
                        "●"
                    } else {
                        "○"
                    },
                    if status.product_configured {
                        "●"
                    } else {
                        "○"
                    }
                );
                let body = ui::shell(
                    frame,
                    &format!("v{}", env!("CARGO_PKG_VERSION")),
                    &self.notice,
                    self.theme.t(
                        "1–7 打开  ↑↓ 选择  Enter 进入  ? 帮助  q 退出",
                        "1–7 open  ↑↓ select  Enter open  ? help  q quit",
                    ),
                    &self.theme,
                );
                let [status_area, menu] =
                    Layout::vertical([Constraint::Length(2), Constraint::Min(1)]).areas(body);
                frame.render_widget(
                    Paragraph::new(summary).style(self.theme.muted()),
                    status_area,
                );
                let rows = labels(&self.theme)
                    .iter()
                    .enumerate()
                    .map(|(i, label)| format!("{}  {label}", i + 1))
                    .collect();
                ui::list(frame, menu, "", rows, self.selected, &self.theme);
            }
            Screen::Relay => self.relay.render(frame, &self.theme),
            Screen::Clients => self.clients.render(frame, status),
            Screen::Router => self.router.render(frame),
            Screen::Login => {
                let elapsed = self
                    .login
                    .as_ref()
                    .map(|l| l.started.elapsed().as_secs())
                    .unwrap_or(0);
                let body = ui::shell(
                    frame,
                    self.theme.t("登录", "Sign in"),
                    "",
                    self.theme.t("Esc 取消", "Esc cancel"),
                    &self.theme,
                );
                ui::text(
                    frame,
                    body,
                    "",
                    &format!(
                        "{}  {elapsed}s",
                        self.theme.t("等待浏览器授权…", "Waiting for browser…")
                    ),
                    0,
                );
            }
            Screen::Account | Screen::Product | Screen::Diagnostics => {
                let (title, content) = match self.screen {
                    Screen::Account => (self.theme.t("账户", "Account"), self.account_text()),
                    Screen::Product => ("JSON Endpoints", self.product.content.clone()),
                    _ => (
                        self.theme.t("诊断", "Diagnostics"),
                        self.diagnostics(status),
                    ),
                };
                let body = ui::shell(
                    frame,
                    title,
                    "",
                    self.theme.t(
                        "↑↓ 滚动  r 刷新  ? 帮助  Esc 返回",
                        "↑↓ scroll  r refresh  ? help  Esc back",
                    ),
                    &self.theme,
                );
                ui::text(frame, body, "", &content, self.scroll);
            }
        }
        if self.quit && self.busy() {
            let area = frame.area();
            let row =
                ratatui::layout::Rect::new(area.x, area.bottom().saturating_sub(2), area.width, 1);
            frame.render_widget(
                Paragraph::new(self.theme.t("正在完成操作…", "Finishing operation…"))
                    .style(self.theme.accent()),
                row,
            );
        }
    }
    async fn key(
        &mut self,
        key: KeyCode,
        api: &mut ApiClient,
        status: &StatusView<'_>,
        width: u16,
        height: u16,
    ) -> Option<client_setup::LaunchRequest> {
        if self.quit {
            return None;
        }
        if self.help.is_some() {
            if matches!(key, KeyCode::Esc | KeyCode::Char('?')) {
                self.help = None;
            } else {
                let content = self.help_text();
                ui::text_scroll(key, self.help.as_mut().unwrap(), &content, width, height);
            }
            return None;
        }
        if self.screen == Screen::Login && matches!(key, KeyCode::Esc | KeyCode::Char('q')) {
            if let Some(login) = self.login.take() {
                login.task.abort();
            }
            self.screen = Screen::Home;
            return None;
        }
        if !self.captures() {
            if key == KeyCode::Char('q') {
                self.quit = true;
                return None;
            }
            if key == KeyCode::Char('?') {
                self.help = Some(0);
                return None;
            }
        }
        match self.screen {
            Screen::Home => {
                if let KeyCode::Char(ch @ '1'..='7') = key {
                    self.selected = (ch as u8 - b'1') as usize;
                    self.open(HOME[self.selected], api, status);
                } else if key == KeyCode::Enter {
                    self.open(HOME[self.selected], api, status);
                } else if key == KeyCode::Esc {
                    self.quit = true;
                } else {
                    ui::navigate(key, &mut self.selected, HOME.len(), height);
                }
            }
            Screen::Relay => {
                if self.relay.key(key, api, &self.theme, width, height) {
                    self.screen = Screen::Home;
                    self.selected = 2;
                }
            }
            Screen::Clients => match self.clients.key(key, api, width, height) {
                client_setup::Action::Back => {
                    self.screen = Screen::Home;
                    self.selected = 3;
                }
                client_setup::Action::Launch(request) => return Some(request),
                _ => {}
            },
            Screen::Router => {
                if self.router.key(key, api, width, height) {
                    self.screen = Screen::Home;
                    self.selected = 6;
                }
            }
            Screen::Account | Screen::Product | Screen::Diagnostics => {
                if key == KeyCode::Esc {
                    self.screen = Screen::Home;
                } else if key == KeyCode::Char('r') {
                    match self.screen {
                        Screen::Account => self.load_account(api),
                        Screen::Product => self.load_product(api),
                        _ => {}
                    }
                } else {
                    let content = match self.screen {
                        Screen::Account => self.account_text(),
                        Screen::Product => self.product.content.clone(),
                        _ => self.diagnostics(status),
                    };
                    ui::text_scroll(key, &mut self.scroll, &content, width, height);
                }
            }
            Screen::Login => {}
        }
        None
    }
}
fn restore_terminal() {
    let _ = disable_raw_mode();
    let _ = execute!(stdout(), Show, LeaveAlternateScreen);
}
struct TerminalGuard;
impl TerminalGuard {
    fn enter() -> Result<Self> {
        enable_raw_mode()?;
        let guard = Self;
        execute!(stdout(), EnterAlternateScreen, Clear(ClearType::All), Hide)?;
        Ok(guard)
    }
}
impl Drop for TerminalGuard {
    fn drop(&mut self) {
        restore_terminal();
    }
}

pub async fn run(mut status: StatusView<'_>, mut api: ApiClient) -> Result<()> {
    anyhow::ensure!(
        std::io::stdin().is_terminal() && stdout().is_terminal(),
        "Use a subcommand or --json outside a terminal"
    );
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        restore_terminal();
        previous(info);
    }));
    let mut guard = Some(TerminalGuard::enter()?);
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    let mut app = App::new(&status);
    loop {
        app.poll(&mut api, &mut status).await;
        if app.quit && !app.busy() {
            break;
        }
        terminal.draw(|frame| app.render(frame, &status))?;
        if !event::poll(ui::POLL_TICK)? {
            continue;
        }
        match event::read()? {
            Event::Resize(_, _) => terminal.clear()?,
            Event::Key(key) if key.kind == KeyEventKind::Press => {
                if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
                    app.quit = true;
                    continue;
                }
                if let Some(request) = app
                    .key(
                        key.code,
                        &mut api,
                        &status,
                        terminal.size()?.width,
                        terminal.size()?.height.saturating_sub(4),
                    )
                    .await
                {
                    // The child owns a normal terminal. Re-enter even when launching fails.
                    drop(guard.take());
                    let result = if request.router {
                        crate::router::clients::launch(
                            request.client,
                            request.model.as_deref(),
                            &[],
                        )
                        .await
                    } else {
                        crate::features::integrations::launch(
                            request.client,
                            &api.credentials,
                            &api.relay_base_url,
                            request.model.as_deref(),
                            &[],
                        )
                    };
                    guard = Some(TerminalGuard::enter()?);
                    terminal.clear()?;
                    app.clients.launched(result);
                }
            }
            _ => {}
        }
    }
    drop(guard);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn status(events: &EventBuffer) -> StatusView<'_> {
        StatusView {
            api_base_url: "https://api.example.test",
            relay_base_url: "https://relay.example.test",
            auth_base_url: "https://auth.example.test",
            locale: "zh-CN",
            no_color: false,
            config_path: "fixture/config.json",
            log_path: "fixture/quyan.log",
            account_configured: true,
            relay_configured: false,
            product_configured: false,
            events,
        }
    }
    #[test]
    fn compact_home_exposes_customer_actions_without_explanatory_panels() {
        for (width, height) in [(120, 36), (80, 24), (60, 20)] {
            for locale in ["zh-CN", "en-US"] {
                for no_color in [false, true] {
                    let events = EventBuffer::new();
                    let mut status = status(&events);
                    status.locale = locale;
                    status.no_color = no_color;
                    let app = App::new(&status);
                    let mut terminal =
                        Terminal::new(ratatui::backend::TestBackend::new(width, height)).unwrap();
                    terminal.draw(|frame| app.render(frame, &status)).unwrap();
                    let output = format!("{:?}", terminal.backend().buffer());
                    assert!(output.contains(if locale == "zh-CN" {
                        "本地路由"
                    } else {
                        "Local Router"
                    }));
                    assert!(!output.contains("Recent events"));
                    assert!(!output.contains("OAuth /"));
                    assert!(!output.contains("fixture/config"));
                    if no_color {
                        assert!(terminal
                            .backend()
                            .buffer()
                            .content
                            .iter()
                            .all(|cell| cell.fg == ratatui::style::Color::Reset
                                && cell.bg == ratatui::style::Color::Reset));
                    }
                }
            }
        }
    }
    #[tokio::test]
    async fn input_keeps_character_shortcuts_and_confirmation_escape_local() {
        let events = EventBuffer::new();
        let status = status(&events);
        let mut app = App::new(&status);
        let mut api = ApiClient::with_endpoints(
            Credentials::default(),
            "zh-CN",
            "http://127.0.0.1:1",
            "http://127.0.0.1:1",
        )
        .unwrap();
        app.screen = Screen::Relay;
        app.key(KeyCode::Char('c'), &mut api, &status, 80, 20).await;
        app.key(KeyCode::Char('q'), &mut api, &status, 80, 20).await;
        assert!(!app.quit);
        app.key(KeyCode::Enter, &mut api, &status, 80, 20).await;
        app.key(KeyCode::Esc, &mut api, &status, 80, 20).await;
        assert!(app.screen == Screen::Relay);
        assert!(!app.busy());
    }
    #[tokio::test]
    async fn account_sections_keep_independent_results_on_failure() {
        let events = EventBuffer::new();
        let mut status = status(&events);
        let mut app = App::new(&status);
        let mut api = ApiClient::with_endpoints(
            Credentials::default(),
            "zh-CN",
            "http://127.0.0.1:1",
            "http://127.0.0.1:1",
        )
        .unwrap();
        app.account[0].task = Some(tokio::spawn(async {
            Ok(serde_json::json!({"username":"customer"}))
        }));
        app.account[1].task = Some(tokio::spawn(async {
            Err(anyhow::anyhow!("fixture denied"))
        }));
        app.account[2].task = Some(tokio::spawn(async {
            Ok(serde_json::json!({"requestCount":42}))
        }));
        while app.account.iter().any(|section| {
            section
                .task
                .as_ref()
                .is_some_and(|task| !task.is_finished())
        }) {
            tokio::task::yield_now().await;
        }
        app.poll(&mut api, &mut status).await;
        assert!(app.account[0].content.contains("customer"));
        assert!(app.account[1].content.contains("denied"));
        assert!(app.account[2].content.contains("42"));
    }
}

use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Text},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Wrap},
    Terminal,
};
use serde_json::Value;
use std::io::stdout;

use crate::{
    api::ApiClient,
    branding::QUYAN_BANNER,
    cli, credentials, integrations,
    logging::{self, EventBuffer},
    services::{account, json_endpoint_product, relay},
};

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

#[derive(Clone, Copy, PartialEq, Eq)]
enum ActionKind {
    BrowserLogin,
    Account,
    Relay,
    Apply,
    JsonEndpoints,
    Config,
}

struct TuiAction {
    kind: ActionKind,
    label: &'static str,
    description: &'static str,
    command: &'static str,
    credential: &'static str,
}

#[derive(Default)]
struct RelayTokenSummary {
    id: String,
    name: String,
    status: String,
    balance: String,
    request_count: String,
    total_tokens: String,
    used_quota: String,
}

#[derive(Default)]
struct RelayState {
    tokens: Vec<RelayTokenSummary>,
    selected: usize,
    usage: Option<Value>,
    notice: String,
    confirmation: Option<RelayConfirmation>,
}

enum RelayConfirmation {
    Create,
    Delete { id: String, name: String },
}

enum Screen {
    Home {
        selected: usize,
        show_help: bool,
    },
    Relay(RelayState),
    Output {
        selected: usize,
        title: String,
        content: String,
    },
}

fn actions(locale: &str) -> Vec<TuiAction> {
    let chinese = locale == "zh-CN";
    vec![
        TuiAction {
            kind: ActionKind::BrowserLogin,
            label: if chinese {
                "浏览器登录"
            } else {
                "Browser login"
            },
            description: if chinese {
                "在浏览器中完成 OAuth 授权并安全保存账户凭证。"
            } else {
                "Complete OAuth authorization in a browser and store account credentials securely."
            },
            command: "quyan login --browser",
            credential: if chinese {
                "账户凭证: OAuth / ak_"
            } else {
                "Account credential: OAuth / ak_"
            },
        },
        TuiAction {
            kind: ActionKind::Account,
            label: if chinese {
                "账户概览"
            } else {
                "Account overview"
            },
            description: if chinese {
                "查看个人资料、余额和用量。"
            } else {
                "View your profile, balance, and usage."
            },
            command: "quyan account",
            credential: if chinese {
                "需要账户凭证"
            } else {
                "Requires an account credential"
            },
        },
        TuiAction {
            kind: ActionKind::Relay,
            label: if chinese { "AI 中转" } else { "AI Relay" },
            description: if chinese {
                "管理 Relay Token、查看渠道和用量。按 Enter 打开。"
            } else {
                "Manage Relay tokens and inspect usage. Press Enter to open."
            },
            command: "quyan relay token list",
            credential: if chinese {
                "需要账户凭证"
            } else {
                "Requires an account credential"
            },
        },
        TuiAction {
            kind: ActionKind::Apply,
            label: if chinese {
                "配置 AI 客户端"
            } else {
                "Configure AI clients"
            },
            description: if chinese {
                "预览或应用 Claude Code、Codex CLI 的本地配置。"
            } else {
                "Preview or apply local configuration for Claude Code and Codex CLI."
            },
            command: "quyan apply --dry-run",
            credential: if chinese {
                "需要 rlt_ Relay Token"
            } else {
                "Requires an rlt_ Relay Token"
            },
        },
        TuiAction {
            kind: ActionKind::JsonEndpoints,
            label: "JSON Endpoints",
            description: if chinese {
                "读取独立 JSON 产品实例的内容和用量。"
            } else {
                "Read content and usage for the JSON Endpoints product instance."
            },
            command: "quyan product json-endpoints get",
            credential: if chinese {
                "需要 dpk_ Product API Key"
            } else {
                "Requires a dpk_ Product API Key"
            },
        },
        TuiAction {
            kind: ActionKind::Config,
            label: if chinese {
                "配置与诊断"
            } else {
                "Configuration and diagnostics"
            },
            description: if chinese {
                "查看脱敏配置；需要详细诊断时使用 --debug。"
            } else {
                "View masked configuration; add --debug for detailed diagnostics."
            },
            command: "quyan config get",
            credential: if chinese {
                "不显示任何密钥"
            } else {
                "Never displays secret values"
            },
        },
    ]
}

pub async fn run(status: StatusView<'_>, mut api: ApiClient) -> Result<()> {
    enable_raw_mode()?;
    let mut out = stdout();
    execute!(out, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(out);
    let mut terminal = Terminal::new(backend)?;
    let actions = actions(status.locale);
    let mut screen = Screen::Home {
        selected: 0,
        show_help: false,
    };
    let result = loop {
        terminal.draw(|frame| render(frame, &status, &actions, &screen))?;
        if !event::poll(std::time::Duration::from_millis(200))? {
            continue;
        }
        let Event::Key(key) = event::read()? else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }
        match &mut screen {
            Screen::Home {
                selected,
                show_help,
            } => match key.code {
                KeyCode::Char('q') | KeyCode::Esc => break Ok(()),
                KeyCode::Up | KeyCode::Char('k') => {
                    *selected = selected.checked_sub(1).unwrap_or(actions.len() - 1);
                    *show_help = false;
                }
                KeyCode::Down | KeyCode::Char('j') => {
                    *selected = (*selected + 1) % actions.len();
                    *show_help = false;
                }
                KeyCode::Char('?') | KeyCode::Char('h') => *show_help = !*show_help,
                KeyCode::Enter => match actions[*selected].kind {
                    ActionKind::Relay => {
                        let mut relay_state = RelayState {
                            notice: "Loading Relay Tokens...".into(),
                            ..Default::default()
                        };
                        refresh_relay(&api, &mut relay_state).await;
                        screen = Screen::Relay(relay_state);
                    }
                    action => {
                        let (title, content) = run_home_action(action, &status, &mut api).await;
                        screen = Screen::Output {
                            selected: *selected,
                            title,
                            content,
                        };
                    }
                },
                _ => {}
            },
            Screen::Relay(state) => match key.code {
                KeyCode::Char('q') => break Ok(()),
                KeyCode::Esc | KeyCode::Char('b') => {
                    screen = Screen::Home {
                        selected: 2,
                        show_help: false,
                    }
                }
                KeyCode::Up | KeyCode::Char('k') if state.confirmation.is_none() => {
                    if !state.tokens.is_empty() {
                        state.selected = state
                            .selected
                            .checked_sub(1)
                            .unwrap_or(state.tokens.len() - 1);
                        state.usage = None;
                    }
                }
                KeyCode::Down | KeyCode::Char('j') if state.confirmation.is_none() => {
                    if !state.tokens.is_empty() {
                        state.selected = (state.selected + 1) % state.tokens.len();
                        state.usage = None;
                    }
                }
                KeyCode::Char('r') if state.confirmation.is_none() => {
                    refresh_relay(&api, state).await
                }
                KeyCode::Enter if state.confirmation.is_none() => load_usage(&api, state).await,
                KeyCode::Char('c') if state.confirmation.is_none() => {
                    state.confirmation = Some(RelayConfirmation::Create)
                }
                KeyCode::Char('d') if state.confirmation.is_none() => {
                    if let Some(token) = state.tokens.get(state.selected) {
                        state.confirmation = Some(RelayConfirmation::Delete {
                            id: token.id.clone(),
                            name: token.name.clone(),
                        });
                    }
                }
                KeyCode::Char('y') => confirm_relay_action(&api, state).await,
                KeyCode::Char('n') => {
                    state.confirmation = None;
                    state.notice = "Action cancelled".into();
                }
                _ => {}
            },
            Screen::Output { selected, .. } => match key.code {
                KeyCode::Char('q') => break Ok(()),
                KeyCode::Esc | KeyCode::Char('b') | KeyCode::Enter => {
                    screen = Screen::Home {
                        selected: *selected,
                        show_help: false,
                    }
                }
                _ => {}
            },
        }
    };
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    result
}

async fn run_home_action(
    action: ActionKind,
    status: &StatusView<'_>,
    api: &mut ApiClient,
) -> (String, String) {
    let result = match action {
        ActionKind::BrowserLogin => match cli::browser_login(&api.api_base_url).await {
            Ok(new_credentials) => match credentials::save(&new_credentials) {
                Ok(()) => {
                    api.credentials = new_credentials;
                    Ok(serde_json::json!({"loggedIn": true, "message": "Browser login completed. Credentials were stored in the system keychain."}))
                }
                Err(error) => Err(error),
            },
            Err(error) => Err(error),
        },
        ActionKind::Account => {
            futures::try_join!(account::profile(api), account::balance(api), account::usage(api))
                .map(|(profile, balance, usage)| serde_json::json!({"profile": profile, "balance": balance, "usage": usage}))
        }
        ActionKind::Apply => integrations::apply(&api.credentials, None, true, true),
        ActionKind::JsonEndpoints => json_endpoint_product::get(api).await,
        ActionKind::Config => Ok(serde_json::json!({
            "apiBaseUrl": status.api_base_url,
            "relayBaseUrl": status.relay_base_url,
            "configPath": status.config_path,
            "accountConfigured": status.account_configured,
            "relayConfigured": status.relay_configured,
            "productConfigured": status.product_configured,
            "logPath": status.log_path,
        })),
        ActionKind::Relay => unreachable!("Relay opens its dedicated TUI screen"),
    };
    let title = match action {
        ActionKind::BrowserLogin => "Browser login",
        ActionKind::Account => "Account overview",
        ActionKind::Apply => "AI client configuration preview",
        ActionKind::JsonEndpoints => "JSON Endpoints",
        ActionKind::Config => "Configuration",
        ActionKind::Relay => "AI Relay",
    };
    let content = match result {
        Ok(value) => safe_pretty_json(&value),
        Err(error) => format!(
            "Operation failed:\n{}",
            logging::redact(&format!("{error:#}"))
        ),
    };
    (title.into(), content)
}

async fn refresh_relay(api: &ApiClient, state: &mut RelayState) {
    state.notice = "Loading Relay Tokens...".into();
    state.usage = None;
    match relay::tokens(api).await {
        Ok(value) => {
            state.tokens = parse_relay_tokens(&value);
            state.selected = state.selected.min(state.tokens.len().saturating_sub(1));
            state.notice = if state.tokens.is_empty() {
                "No Relay Tokens found. Press c to create one.".into()
            } else {
                format!("Loaded {} Relay Token(s)", state.tokens.len())
            };
            tracing::info!(
                token_count = state.tokens.len(),
                "loaded Relay Tokens in TUI"
            );
        }
        Err(error) => {
            state.tokens.clear();
            state.notice = format!(
                "Could not load Relay Tokens: {}",
                logging::redact(&format!("{error:#}"))
            );
            tracing::warn!(error = %logging::redact(&format!("{error:#}")), "failed to load Relay Tokens in TUI");
        }
    }
}

async fn load_usage(api: &ApiClient, state: &mut RelayState) {
    let Some(token) = state.tokens.get(state.selected) else {
        state.notice = "No Relay Token is selected".into();
        return;
    };
    state.notice = format!("Loading usage for {}...", token.name);
    match relay::token_usage(api, &token.id).await {
        Ok(value) => {
            state.usage = Some(value);
            state.notice = "Usage loaded".into();
        }
        Err(error) => {
            state.notice = format!(
                "Could not load usage: {}",
                logging::redact(&format!("{error:#}"))
            );
        }
    }
}

async fn confirm_relay_action(api: &ApiClient, state: &mut RelayState) {
    let Some(action) = state.confirmation.take() else {
        return;
    };
    let result = match action {
        RelayConfirmation::Create => relay::create_token(api)
            .await
            .map(|_| "Relay Token created".to_string()),
        RelayConfirmation::Delete { id, name } => relay::delete_token(api, &id)
            .await
            .map(|_| format!("Relay Token '{name}' deleted")),
    };
    match result {
        Ok(notice) => {
            state.notice = notice;
            refresh_relay(api, state).await;
        }
        Err(error) => {
            state.notice = format!("Action failed: {}", logging::redact(&format!("{error:#}")))
        }
    }
}

fn parse_relay_tokens(value: &Value) -> Vec<RelayTokenSummary> {
    let Some(items) = value.get("items").and_then(Value::as_array) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?.to_string();
            Some(RelayTokenSummary {
                id,
                name: item
                    .get("name")
                    .and_then(Value::as_str)
                    .filter(|name| !name.is_empty())
                    .unwrap_or("Unnamed token")
                    .to_string(),
                status: match item.get("status").and_then(Value::as_i64) {
                    Some(1) => "active",
                    Some(0) => "disabled",
                    Some(_) => "deleted",
                    None => "unknown",
                }
                .into(),
                balance: value_label(item.get("balance")),
                request_count: value_label(item.get("requestCount")),
                total_tokens: value_label(item.get("totalTokens")),
                used_quota: value_label(item.get("usedQuota")),
            })
        })
        .collect()
}

fn value_label(value: Option<&Value>) -> String {
    match value {
        Some(Value::Number(number)) => number.to_string(),
        Some(Value::String(text)) => text.clone(),
        _ => "-".into(),
    }
}

fn safe_pretty_json(value: &Value) -> String {
    logging::redact(&serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".into()))
}

fn render(
    frame: &mut ratatui::Frame,
    status: &StatusView<'_>,
    actions: &[TuiAction],
    screen: &Screen,
) {
    match screen {
        Screen::Home {
            selected,
            show_help,
        } => render_home(frame, status, actions, *selected, *show_help),
        Screen::Relay(state) => render_relay(frame, status, state),
        Screen::Output { title, content, .. } => render_output(frame, title, content),
    }
}

fn render_output(frame: &mut ratatui::Frame, title: &str, content: &str) {
    let [header, body, footer] = Layout::vertical([
        Constraint::Length(4),
        Constraint::Min(8),
        Constraint::Length(2),
    ])
    .areas(frame.area());
    frame.render_widget(
        Paragraph::new(format!("QuYan {}  |  {title}", env!("CARGO_PKG_VERSION")))
            .block(Block::default().borders(Borders::ALL).title(" QuYan ")),
        header,
    );
    frame.render_widget(
        Paragraph::new(content)
            .block(Block::default().borders(Borders::ALL).title(" Result "))
            .wrap(Wrap { trim: false }),
        body,
    );
    render_footer(frame, footer, "Enter, b, or Esc: return  |  q: exit");
}

fn render_home(
    frame: &mut ratatui::Frame,
    status: &StatusView<'_>,
    actions: &[TuiAction],
    selected: usize,
    show_help: bool,
) {
    let area = frame.area();
    let compact = area.width < 92 || area.height < 30;
    if compact {
        let [header, menu, footer] = Layout::vertical([
            Constraint::Length(9),
            Constraint::Min(8),
            Constraint::Length(2),
        ])
        .areas(area);
        render_banner(frame, header, "CLI control center");
        render_action_list(frame, menu, actions, selected);
        render_footer(
            frame,
            footer,
            "Up/Down or j/k: select  |  Enter: open  |  q/Esc: exit",
        );
        return;
    }
    let [header, main, events, footer] = Layout::vertical([
        Constraint::Length(9),
        Constraint::Min(12),
        Constraint::Length(6),
        Constraint::Length(2),
    ])
    .areas(area);
    render_banner(frame, header, "CLI control center");
    let [menu, detail] =
        Layout::horizontal([Constraint::Percentage(38), Constraint::Percentage(62)]).areas(main);
    render_action_list(frame, menu, actions, selected);
    render_home_detail(frame, detail, status, &actions[selected], show_help);
    let entries = status
        .events
        .entries()
        .cloned()
        .map(Line::from)
        .collect::<Vec<_>>();
    frame.render_widget(
        Paragraph::new(entries)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(" Recent events "),
            )
            .wrap(Wrap { trim: false }),
        events,
    );
    render_footer(
        frame,
        footer,
        "Up/Down or j/k: select  |  Enter: open selected tool  |  ?/h: help  |  q/Esc: exit",
    );
}

fn render_relay(frame: &mut ratatui::Frame, status: &StatusView<'_>, state: &RelayState) {
    let area = frame.area();
    let compact = area.width < 92 || area.height < 26;
    let [header, main, footer] = Layout::vertical([
        Constraint::Length(4),
        Constraint::Min(10),
        Constraint::Length(3),
    ])
    .areas(area);
    frame.render_widget(
        Paragraph::new(format!(
            "QuYan {}  |  AI Relay Token management\n{}",
            env!("CARGO_PKG_VERSION"),
            state.notice
        ))
        .block(Block::default().borders(Borders::ALL).title(" AI Relay "))
        .wrap(Wrap { trim: false }),
        header,
    );
    if compact {
        render_relay_token_list(frame, main, state);
    } else {
        let [list, detail] =
            Layout::horizontal([Constraint::Percentage(45), Constraint::Percentage(55)])
                .areas(main);
        render_relay_token_list(frame, list, state);
        render_relay_detail(frame, detail, status, state);
    }
    let footer_text = if state.confirmation.is_some() {
        "y: confirm  |  n: cancel"
    } else {
        "Up/Down or j/k: select  |  Enter: usage  |  r: refresh  |  c: create  |  d: delete  |  b/Esc: back  |  q: exit"
    };
    render_footer(frame, footer, footer_text);
}

fn render_banner(frame: &mut ratatui::Frame, area: Rect, title: &str) {
    frame.render_widget(
        Paragraph::new(format!(
            "{QUYAN_BANNER}\nQuYan {}  |  {title}",
            env!("CARGO_PKG_VERSION")
        ))
        .block(Block::default().borders(Borders::ALL).title(" QuYan "))
        .wrap(Wrap { trim: false }),
        area,
    );
}

fn render_action_list(
    frame: &mut ratatui::Frame,
    area: Rect,
    actions: &[TuiAction],
    selected: usize,
) {
    let entries = actions
        .iter()
        .map(|action| ListItem::new(Line::from(action.label)))
        .collect::<Vec<_>>();
    render_list(frame, area, entries, selected, " Actions ");
}

fn render_relay_token_list(frame: &mut ratatui::Frame, area: Rect, state: &RelayState) {
    let entries = if state.tokens.is_empty() {
        vec![ListItem::new("No Relay Tokens")]
    } else {
        state
            .tokens
            .iter()
            .map(|token| ListItem::new(format!("{}  [{}]", token.name, token.status)))
            .collect()
    };
    render_list(frame, area, entries, state.selected, " Relay Tokens ");
}

fn render_list(
    frame: &mut ratatui::Frame,
    area: Rect,
    entries: Vec<ListItem<'_>>,
    selected: usize,
    title: &str,
) {
    let mut state = ListState::default();
    state.select((!entries.is_empty()).then_some(selected));
    frame.render_stateful_widget(
        List::new(entries)
            .block(Block::default().borders(Borders::ALL).title(title))
            .highlight_symbol("> ")
            .highlight_style(Style::default().add_modifier(Modifier::BOLD)),
        area,
        &mut state,
    );
}

fn render_home_detail(
    frame: &mut ratatui::Frame,
    area: Rect,
    status: &StatusView<'_>,
    action: &TuiAction,
    show_help: bool,
) {
    let lines = if show_help {
        vec![
            Line::from("Enter opens interactive tools such as AI Relay."),
            Line::from("Other entries show the exact command to run."),
            Line::from("Credentials are stored only in the OS keychain."),
            Line::from("Use --json for machine-readable command output."),
            Line::from("Use --debug for redacted diagnostic logging."),
        ]
    } else {
        vec![
            Line::from(format!("Selected: {}", action.label)),
            Line::from(action.description),
            Line::from(""),
            Line::from("Command:"),
            Line::from(format!("  {}", action.command))
                .style(Style::default().add_modifier(Modifier::BOLD)),
            Line::from(action.credential),
            Line::from(""),
            Line::from(format!("API: {}", status.api_base_url)),
            Line::from(format!("Relay: {}", status.relay_base_url)),
            Line::from(format!(
                "Credentials: account={} relay={} product={}",
                configured(status.account_configured),
                configured(status.relay_configured),
                configured(status.product_configured)
            )),
            Line::from(format!("Log: {}", status.log_path)),
            Line::from(format!("Config: {}", status.config_path)),
        ]
    };
    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(Block::default().borders(Borders::ALL).title(if show_help {
                " Help "
            } else {
                " Selected action "
            }))
            .wrap(Wrap { trim: false }),
        area,
    );
}

fn render_relay_detail(
    frame: &mut ratatui::Frame,
    area: Rect,
    status: &StatusView<'_>,
    state: &RelayState,
) {
    let lines = if let Some(confirmation) = &state.confirmation {
        match confirmation {
            RelayConfirmation::Create => vec![
                Line::from("Create a new Relay Token named 'Quyan CLI token'?"),
                Line::from("Press y to create or n to cancel."),
                Line::from("The token value will not be displayed in this TUI."),
            ],
            RelayConfirmation::Delete { name, .. } => vec![
                Line::from(format!("Delete Relay Token '{name}'?")),
                Line::from("This cannot be undone. Press y to confirm or n to cancel."),
            ],
        }
    } else if let Some(token) = state.tokens.get(state.selected) {
        let mut lines = vec![
            Line::from(format!("Name: {}", token.name)),
            Line::from(format!("Status: {}", token.status)),
            Line::from(format!("Balance: {}", token.balance)),
            Line::from(format!("Requests: {}", token.request_count)),
            Line::from(format!("Total tokens: {}", token.total_tokens)),
            Line::from(format!("Used quota: {}", token.used_quota)),
            Line::from(""),
            Line::from("Enter loads current usage."),
            Line::from("The secret token value is never displayed."),
        ];
        if let Some(usage) = &state.usage {
            lines.push(Line::from(""));
            lines.push(Line::from("Usage:"));
            lines.push(Line::from(format!(
                "Requests: {}",
                value_label(usage.get("requestCount"))
            )));
            lines.push(Line::from(format!(
                "Total tokens: {}",
                value_label(usage.get("totalTokens"))
            )));
            lines.push(Line::from(format!(
                "Remaining quota: {}",
                value_label(usage.get("remainingQuota"))
            )));
        }
        lines
    } else {
        vec![
            Line::from("No Relay Tokens are available."),
            Line::from("Press c to create a default Quyan CLI token."),
            Line::from(format!("API: {}", status.api_base_url)),
        ]
    };
    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(" Token details "),
            )
            .wrap(Wrap { trim: false }),
        area,
    );
}

fn render_footer(frame: &mut ratatui::Frame, area: Rect, text: &str) {
    frame.render_widget(
        Paragraph::new(text)
            .block(Block::default().borders(Borders::ALL))
            .wrap(Wrap { trim: false }),
        area,
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
    use super::{actions, parse_relay_tokens, render, RelayState, Screen, StatusView};
    use crate::logging::EventBuffer;
    use ratatui::{backend::TestBackend, Terminal};
    use serde_json::json;

    fn status<'a>(events: &'a EventBuffer) -> StatusView<'a> {
        StatusView {
            api_base_url: "https://api.qysyw.cn",
            relay_base_url: "https://ai.qysyw.cn",
            locale: "zh-CN",
            config_path: "C:/config.json",
            account_configured: false,
            relay_configured: true,
            product_configured: false,
            log_path: "C:/logs/quyan.log",
            events,
        }
    }

    #[test]
    fn parses_safe_relay_token_fields_without_exposing_the_token_value() {
        let tokens = parse_relay_tokens(
            &json!({"items":[{"id":"token-1","name":"Primary","token":"rlt_secret","status":1,"balance":12,"requestCount":3,"totalTokens":42,"usedQuota":4}]}),
        );
        assert_eq!(tokens.len(), 1);
        assert_eq!(tokens[0].name, "Primary");
        assert_eq!(tokens[0].status, "active");
        assert!(!format!("{}{}", tokens[0].id, tokens[0].name).contains("rlt_secret"));
    }

    #[test]
    fn home_screen_exposes_the_interactive_ai_relay_entry() {
        let mut terminal = Terminal::new(TestBackend::new(120, 40)).expect("test terminal");
        let mut events = EventBuffer::new();
        events.push("INFO", "CLI started");
        let actions = actions("zh-CN");
        terminal
            .draw(|frame| {
                render(
                    frame,
                    &status(&events),
                    &actions,
                    &Screen::Home {
                        selected: 2,
                        show_help: false,
                    },
                )
            })
            .expect("render");
        let output = format!("{:?}", terminal.backend().buffer());
        assert!(output.contains("AI 中转"));
        assert!(output.contains("按 Enter 打开"));
        assert!(output.contains("Recent events"));
    }

    #[test]
    fn relay_screen_renders_a_safe_token_list() {
        let mut terminal = Terminal::new(TestBackend::new(120, 32)).expect("test terminal");
        let events = EventBuffer::new();
        let actions = actions("en-US");
        let mut relay = RelayState::default();
        relay.tokens = parse_relay_tokens(
            &json!({"items":[{"id":"token-1","name":"Primary","token":"rlt_secret","status":1,"balance":12,"requestCount":3,"totalTokens":42,"usedQuota":4}]}),
        );
        relay.notice = "Loaded 1 Relay Token(s)".into();
        terminal
            .draw(|frame| render(frame, &status(&events), &actions, &Screen::Relay(relay)))
            .expect("render");
        let output = format!("{:?}", terminal.backend().buffer());
        assert!(output.contains("AI Relay"));
        assert!(output.contains("Primary"));
        assert!(!output.contains("rlt_secret"));
    }
}

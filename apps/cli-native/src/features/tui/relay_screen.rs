use super::ui::{self, Theme};
use crate::{
    core::{api::ApiClient, credentials::Credentials},
    services::relay,
};
use crossterm::event::KeyCode;
use ratatui::layout::{Constraint, Layout};
use serde_json::{json, Value};
use tokio::{sync::mpsc, task::JoinHandle};

#[derive(Clone, Default)]
struct Token {
    id: String,
    name: String,
    status: String,
    balance: String,
    requests: String,
    tokens: String,
    quota: String,
}
fn field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .filter(|v| !v.is_null())
        .map(|v| {
            v.as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| v.to_string())
        })
        .unwrap_or_else(|| "—".into())
}
fn parse(value: &Value) -> Vec<Token> {
    value["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| {
            Some(Token {
                id: v["id"].as_str()?.into(),
                name: ui::safe(v["name"].as_str().unwrap_or("—")),
                status: match v["status"].as_i64() {
                    Some(1) => "●",
                    Some(0) => "○",
                    _ => "—",
                }
                .into(),
                balance: field(v, "balance"),
                requests: field(v, "requestCount"),
                tokens: field(v, "totalTokens"),
                quota: field(v, "usedQuota"),
            })
        })
        .collect()
}
enum Load {
    Page {
        tokens: Vec<Token>,
        total: u64,
        page: u64,
        done: bool,
    },
    Error(String),
}
enum Confirm {
    Create(String),
    Rename { id: String, name: String },
    Use { id: String, name: String },
    Delete { id: String, name: String },
}
enum Input {
    Search,
    Name { id: Option<String>, text: String },
}
pub(super) struct RelayView {
    tokens: Vec<Token>,
    selected: usize,
    page: u64,
    total: u64,
    query: String,
    input: Option<Input>,
    confirm: Option<Confirm>,
    notice: String,
    search_error: Option<String>,
    detail: bool,
    scroll: u16,
    loading: Option<JoinHandle<()>>,
    receiver: Option<mpsc::Receiver<Load>>,
    complete: bool,
    scan_all: bool,
    usage: Option<(String, String)>,
    usage_task: Option<JoinHandle<anyhow::Result<(String, Value)>>>,
    write: Option<JoinHandle<anyhow::Result<Option<Credentials>>>>,
    pub credentials: Option<Credentials>,
}
impl Default for RelayView {
    fn default() -> Self {
        Self {
            tokens: vec![],
            selected: 0,
            page: 1,
            total: 0,
            query: String::new(),
            input: None,
            confirm: None,
            notice: String::new(),
            search_error: None,
            detail: false,
            scroll: 0,
            loading: None,
            receiver: None,
            complete: false,
            scan_all: false,
            usage: None,
            usage_task: None,
            write: None,
            credentials: None,
        }
    }
}
impl RelayView {
    pub fn busy(&self) -> bool {
        self.write.is_some()
    }
    pub fn captures(&self) -> bool {
        self.input.is_some() || self.confirm.is_some()
    }
    fn filtered(&self) -> Vec<&Token> {
        let query = self.query.to_lowercase();
        self.tokens
            .iter()
            .filter(|v| {
                query.is_empty()
                    || v.name.to_lowercase().contains(&query)
                    || v.id.to_lowercase().contains(&query)
            })
            .collect()
    }
    fn selected(&self) -> Option<Token> {
        self.filtered().get(self.selected).map(|v| (*v).clone())
    }
    pub fn refresh(&mut self, api: &ApiClient, theme: &Theme) {
        if let Some(task) = self.loading.take() {
            task.abort();
        }
        if let Some(task) = self.usage_task.take() {
            task.abort();
        }
        self.usage = None;
        self.complete = false;
        self.search_error = None;
        self.notice = theme.t("加载中…", "Loading…").into();
        // A search scans all authorized pages; page responses contain safe summaries only.
        let all = self.scan_all || !self.query.is_empty();
        let first = if all { 1 } else { self.page };
        let api = api.clone();
        let (sender, receiver) = mpsc::channel(4);
        self.receiver = Some(receiver);
        self.loading = Some(tokio::spawn(async move {
            let mut page = first;
            loop {
                match relay::tokens_page(&api, page).await {
                    Ok(value) => {
                        let tokens = parse(&value);
                        let total = value["total"].as_u64().unwrap_or(0);
                        let size = value["pageSize"]
                            .as_u64()
                            .unwrap_or(relay::TOKEN_PAGE_SIZE)
                            .max(1);
                        let done = !all || page.saturating_mul(size) >= total;
                        if all && tokens.is_empty() && !done {
                            let _ = sender
                                .send(Load::Error("Incomplete token list".into()))
                                .await;
                            break;
                        }
                        if sender
                            .send(Load::Page {
                                tokens,
                                total,
                                page,
                                done,
                            })
                            .await
                            .is_err()
                            || done
                        {
                            break;
                        }
                        page += 1;
                    }
                    Err(error) => {
                        let _ = sender.send(Load::Error(ui::error(&error))).await;
                        break;
                    }
                }
            }
        }));
    }
    pub async fn poll(&mut self, api: &ApiClient, theme: &Theme) {
        let mut events = Vec::new();
        if let Some(receiver) = &mut self.receiver {
            while let Ok(event) = receiver.try_recv() {
                events.push(event);
            }
        }
        for event in events {
            match event {
                Load::Page {
                    tokens,
                    total,
                    page,
                    done,
                } => {
                    let id = self.selected().map(|v| v.id);
                    if !self.scan_all || page == 1 {
                        self.tokens = tokens;
                    } else {
                        self.tokens.extend(tokens);
                    }
                    self.total = total;
                    self.complete = done;
                    self.selected = id
                        .and_then(|id| self.filtered().iter().position(|v| v.id == id))
                        .unwrap_or(self.selected)
                        .min(self.filtered().len().saturating_sub(1));
                    self.notice = if done {
                        String::new()
                    } else {
                        format!(
                            "{} {}/{}",
                            theme.t("搜索中", "Searching"),
                            self.tokens.len(),
                            total
                        )
                    };
                }
                Load::Error(error) => {
                    self.notice =
                        format!("{} · {error}", theme.t("结果不完整", "Incomplete results"));
                    self.search_error = Some(self.notice.clone());
                    self.complete = false;
                }
            }
        }
        if self
            .usage_task
            .as_ref()
            .is_some_and(JoinHandle::is_finished)
        {
            let task = self.usage_task.take().unwrap();
            match task.await {
                Ok(Ok((id, value))) if self.selected().is_some_and(|v| v.id == id) => {
                    self.usage = Some((id, crate::utils::output::human(&value, &theme.locale)));
                    self.notice.clear();
                }
                Ok(Err(error)) => self.notice = ui::error(&error),
                _ => {}
            }
        }
        if self.write.as_ref().is_some_and(JoinHandle::is_finished) {
            match self.write.take().unwrap().await {
                Ok(Ok(credentials)) => {
                    self.credentials = credentials;
                    self.refresh(api, theme);
                    self.notice = theme.t("已完成", "Done").into();
                }
                Ok(Err(error)) => self.notice = ui::error(&error),
                Err(_) => {
                    self.notice = theme
                        .t("操作失败，请刷新", "Operation failed; refresh")
                        .into()
                }
            }
        }
    }
    pub fn key(
        &mut self,
        key: KeyCode,
        api: &ApiClient,
        theme: &Theme,
        width: u16,
        height: u16,
    ) -> bool {
        if let Some(input) = &mut self.input {
            match input {
                Input::Search => match key {
                    KeyCode::Esc | KeyCode::Enter => self.input = None,
                    KeyCode::Backspace => {
                        self.query.pop();
                        self.selected = 0;
                    }
                    KeyCode::Char(ch) if !ch.is_control() => {
                        self.query.push(ch);
                        self.selected = 0;
                    }
                    _ => {}
                },
                Input::Name { id, text } => match key {
                    KeyCode::Esc => self.input = None,
                    KeyCode::Backspace => {
                        text.pop();
                    }
                    KeyCode::Char(ch) if !ch.is_control() && text.chars().count() < 100 => {
                        text.push(ch)
                    }
                    KeyCode::Enter if !text.trim().is_empty() => {
                        self.confirm = Some(match id {
                            Some(id) => Confirm::Rename {
                                id: id.clone(),
                                name: text.trim().into(),
                            },
                            None => Confirm::Create(text.trim().into()),
                        });
                        self.input = None;
                    }
                    _ => {}
                },
            }
            return false;
        }
        if self.confirm.is_some() {
            match key {
                KeyCode::Char('y') if !self.busy() => {
                    let action = self.confirm.take().unwrap();
                    let api = api.clone();
                    self.notice = theme.t("执行中…", "Applying…").into();
                    self.write = Some(tokio::spawn(async move {
                        match action {
                            Confirm::Create(name) => {
                                relay::create_token(&api, Some(name), None, false, None, None)
                                    .await?;
                            }
                            Confirm::Rename { id, name } => {
                                relay::update_token(&api, &id, json!({"name":name})).await?;
                            }
                            Confirm::Delete { id, .. } => {
                                relay::delete_token(&api, &id).await?;
                            }
                            Confirm::Use { id, .. } => {
                                let credentials = relay::credentials_with_token(&api, &id).await?;
                                return tokio::task::spawn_blocking(move || {
                                    crate::core::credentials::save(&credentials)?;
                                    Ok(Some(credentials))
                                })
                                .await?;
                            }
                        }
                        Ok(None)
                    }));
                }
                KeyCode::Char('n') | KeyCode::Esc | KeyCode::Enter => self.confirm = None,
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
            let content = self.details(theme);
            if ui::text_scroll(
                key,
                &mut self.scroll,
                &content,
                if width >= 92 { width * 60 / 100 } else { width },
                height.saturating_sub(1),
            ) {
                return false;
            }
        }
        let len = self.filtered().len();
        if ui::navigate(key, &mut self.selected, len, height) {
            if let Some(task) = self.usage_task.take() {
                task.abort();
            }
            self.usage = None;
            self.scroll = 0;
            return false;
        }
        match key {
            KeyCode::Esc => return true,
            KeyCode::Char('/') => {
                self.input = Some(Input::Search);
                // Load all pages once; edits then filter these results locally.
                if !self.scan_all {
                    self.scan_all = true;
                    self.refresh(api, theme);
                }
            }
            KeyCode::Char('r') => self.refresh(api, theme),
            KeyCode::Left if !self.scan_all && self.page > 1 => {
                self.page -= 1;
                self.refresh(api, theme);
            }
            KeyCode::Right if !self.scan_all && self.page * relay::TOKEN_PAGE_SIZE < self.total => {
                self.page += 1;
                self.refresh(api, theme);
            }
            KeyCode::Enter => {
                self.detail = true;
                self.scroll = 0;
                if let Some(token) = self.selected() {
                    if let Some(task) = self.usage_task.take() {
                        task.abort();
                    }
                    let api = api.clone();
                    self.notice = theme.t("加载中…", "Loading…").into();
                    self.usage_task = Some(tokio::spawn(async move {
                        let value = relay::token_usage(&api, &token.id).await?;
                        Ok((token.id, value))
                    }));
                }
            }
            KeyCode::Char('c') if !self.busy() => {
                self.input = Some(Input::Name {
                    id: None,
                    text: String::new(),
                })
            }
            KeyCode::Char('e') if !self.busy() => {
                if let Some(token) = self.selected() {
                    self.input = Some(Input::Name {
                        id: Some(token.id),
                        text: token.name,
                    });
                }
            }
            KeyCode::Char('d') if !self.busy() => {
                if let Some(token) = self.selected() {
                    self.confirm = Some(Confirm::Delete {
                        id: token.id,
                        name: token.name,
                    });
                }
            }
            KeyCode::Char('u') if !self.busy() => {
                if let Some(token) = self.selected() {
                    self.confirm = Some(Confirm::Use {
                        id: token.id,
                        name: token.name,
                    });
                }
            }
            _ => {}
        }
        false
    }
    fn details(&self, theme: &Theme) -> String {
        let Some(token) = self.selected() else {
            return theme.t("暂无令牌", "No tokens").into();
        };
        let mut result = crate::utils::output::human(
            &json!({"name":token.name,"id":token.id,"status":token.status,"balance":token.balance,"requestCount":token.requests,"totalTokens":token.tokens,"usedQuota":token.quota}),
            &theme.locale,
        );
        if let Some((id, usage)) = &self.usage {
            if *id == token.id {
                result.push_str(&format!("\n\n{usage}"));
            }
        }
        result
    }
    pub fn render(&self, frame: &mut ratatui::Frame, theme: &Theme) {
        let footer = if self.confirm.is_some() {
            theme.t("y 确认  n/Esc 取消", "y confirm  n/Esc cancel")
        } else if self.input.is_some() {
            theme.t("Enter 完成  Esc 返回", "Enter done  Esc back")
        } else {
            theme.t(
                "/ 搜索  Enter 用量  c 新建  ? 帮助  Esc 返回",
                "/ search  Enter usage  c new  ? help  Esc back",
            )
        };
        let notice = if self.notice.is_empty() {
            self.search_error.as_deref().unwrap_or_default()
        } else {
            &self.notice
        };
        let area = ui::shell(frame, theme.t("AI 中转", "AI Relay"), notice, footer, theme);
        if let Some(confirm) = &self.confirm {
            let content = match confirm {
                Confirm::Create(name) => format!("{}  {name}", theme.t("创建令牌", "Create token")),
                Confirm::Rename { id, name } => {
                    format!("{}  {name}\nID  {id}", theme.t("重命名", "Rename"))
                }
                Confirm::Use { id, name } => {
                    format!("{}  {name}\nID  {id}", theme.t("选用令牌", "Use token"))
                }
                Confirm::Delete { id, name } => format!(
                    "{}  {name}\nID  {id}\n{}",
                    theme.t("删除令牌", "Delete token"),
                    theme.t("不可撤回", "Cannot be undone")
                ),
            };
            ui::text(frame, area, theme.t("确认", "Confirm"), &content, 0);
            return;
        }
        if let Some(Input::Name { text, .. }) = &self.input {
            ui::text(
                frame,
                area,
                theme.t("令牌名称", "Token name"),
                &format!("{text}▏"),
                0,
            );
            return;
        }
        let [filter, body] =
            Layout::vertical([Constraint::Length(1), Constraint::Min(1)]).areas(area);
        let filter_text = if !self.query.is_empty() || matches!(self.input, Some(Input::Search)) {
            format!(
                "/ {}{}  ·  {}{}",
                self.query,
                if self.input.is_some() { "▏" } else { "" },
                self.filtered().len(),
                if self.complete { "" } else { "…" }
            )
        } else {
            format!(
                "{} {}  ·  {} {}",
                theme.t("第", "Page"),
                self.page,
                theme.t("共", "Total"),
                self.total
            )
        };
        frame.render_widget(ratatui::widgets::Paragraph::new(filter_text), filter);
        let rows = self
            .filtered()
            .iter()
            .map(|v| format!("{} {}", v.status, v.name))
            .collect::<Vec<_>>();
        if self.detail && body.width < 92 {
            ui::text(
                frame,
                body,
                theme.t("用量", "Usage"),
                &self.details(theme),
                self.scroll,
            );
        } else if body.width >= 92 {
            let [list, detail] =
                Layout::horizontal([Constraint::Percentage(40), Constraint::Percentage(60)])
                    .areas(body);
            ui::list(
                frame,
                list,
                theme.t("令牌", "Tokens"),
                rows,
                self.selected,
                theme,
            );
            ui::text(
                frame,
                detail,
                theme.t("详情", "Details"),
                &self.details(theme),
                self.scroll,
            );
        } else {
            ui::list(
                frame,
                body,
                theme.t("令牌", "Tokens"),
                if rows.is_empty() {
                    vec![theme.t("暂无结果", "No results").into()]
                } else {
                    rows
                },
                self.selected,
                theme,
            );
        }
    }
}
impl Drop for RelayView {
    fn drop(&mut self) {
        if let Some(task) = self.loading.take() {
            task.abort();
        }
        if let Some(task) = self.usage_task.take() {
            task.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn theme() -> Theme {
        Theme {
            locale: "zh-CN".into(),
            no_color: false,
        }
    }
    #[test]
    fn summaries_never_retain_secrets_and_search_matches_names_and_ids() {
        let tokens = parse(
            &json!({"items":[{"id":"token-a","name":"客户","status":1,"token":"sk-rlt-fixture-secret"}]}),
        );
        let mut view = RelayView::default();
        view.tokens = tokens;
        view.query = "客户".into();
        assert_eq!(view.filtered().len(), 1);
        view.query = "TOKEN-A".into();
        assert_eq!(view.filtered().len(), 1);
        assert!(!view.details(&theme()).contains("secret"));
    }
    #[test]
    fn narrow_confirmation_shows_target_without_secret() {
        for (width, height) in [(120, 36), (80, 24), (60, 20)] {
            let mut terminal =
                ratatui::Terminal::new(ratatui::backend::TestBackend::new(width, height)).unwrap();
            let mut view = RelayView::default();
            view.confirm = Some(Confirm::Delete {
                id: "token-a".into(),
                name: "Customer".into(),
            });
            terminal.draw(|frame| view.render(frame, &theme())).unwrap();
            let output = format!("{:?}", terminal.backend().buffer());
            assert!(output.contains("Customer"));
            assert!(output.contains("token-a"));
        }
    }
    async fn fixture(fail_second: bool) -> (ApiClient, JoinHandle<()>) {
        use axum::{routing::get, Json};
        let app=axum::Router::new().route("/v1/relay/tokens",get(move|uri:axum::http::Uri|async move{
            let page=url::form_urlencoded::parse(uri.query().unwrap().as_bytes()).find(|(key,_)|key=="page").unwrap().1.parse::<u64>().unwrap();
            if fail_second&&page==2 {return (axum::http::StatusCode::SERVICE_UNAVAILABLE,Json(json!({"code":1,"message":"fixture unavailable"})));}
            let items=if page==1{json!([{"id":"a","name":"First","status":1},{"id":"b","name":"Second","status":1}])}else{json!([{"id":"c","name":"Last page","status":1}])};
            (axum::http::StatusCode::OK,Json(json!({"code":0,"message":"OK","data":{"items":items,"page":page,"pageSize":2,"total":3}})))
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (
            ApiClient::with_endpoints(Credentials::default(), "en-US", &base, &base).unwrap(),
            task,
        )
    }
    #[tokio::test]
    async fn search_loads_all_authorized_pages_and_matches_the_last_page() {
        let (api, server) = fixture(false).await;
        let mut view = RelayView::default();
        view.scan_all = true;
        view.query = "last".into();
        view.refresh(&api, &theme());
        view.loading.take().unwrap().await.unwrap();
        view.poll(&api, &theme()).await;
        assert!(view.complete);
        assert_eq!(view.tokens.len(), 3);
        assert_eq!(view.filtered()[0].id, "c");
        server.abort();
    }
    #[tokio::test]
    async fn failed_search_keeps_partial_results_and_marks_them_incomplete() {
        let (api, server) = fixture(true).await;
        let mut view = RelayView::default();
        view.scan_all = true;
        view.refresh(&api, &theme());
        view.loading.take().unwrap().await.unwrap();
        view.poll(&api, &theme()).await;
        assert!(!view.complete);
        assert_eq!(view.tokens.len(), 2);
        assert!(view.notice.contains("不完整"));
        view.usage_task = Some(tokio::spawn(async {
            Ok(("a".into(), json!({"requestCount":42})))
        }));
        while !view.usage_task.as_ref().unwrap().is_finished() {
            tokio::task::yield_now().await;
        }
        view.poll(&api, &theme()).await;
        assert!(view.notice.is_empty());
        let mut terminal =
            ratatui::Terminal::new(ratatui::backend::TestBackend::new(80, 24)).unwrap();
        terminal.draw(|frame| view.render(frame, &theme())).unwrap();
        assert!(format!("{:?}", terminal.backend().buffer()).contains("不完整"));
        server.abort();
    }
    #[tokio::test]
    async fn late_usage_does_not_replace_the_new_selection() {
        let (api, server) = fixture(false).await;
        let mut view = RelayView::default();
        view.tokens =
            parse(&json!({"items":[{"id":"a","name":"First"},{"id":"b","name":"Second"}]}));
        view.selected = 1;
        view.usage_task = Some(tokio::spawn(async {
            Ok(("a".into(), json!({"requestCount":99})))
        }));
        while !view.usage_task.as_ref().unwrap().is_finished() {
            tokio::task::yield_now().await;
        }
        view.poll(&api, &theme()).await;
        assert!(view.usage.is_none());
        server.abort();
    }
    #[tokio::test]
    async fn replacement_load_rejects_old_pages_and_busy_writes_cannot_be_resubmitted() {
        let (api, server) = fixture(false).await;
        let (sender, receiver) = mpsc::channel(1);
        sender
            .send(Load::Page {
                tokens: parse(&json!({"items":[{"id":"stale","name":"Old"}]})),
                total: 1,
                page: 1,
                done: true,
            })
            .await
            .ok()
            .unwrap();
        let mut view = RelayView::default();
        view.receiver = Some(receiver);
        view.refresh(&api, &theme());
        view.loading.take().unwrap().await.unwrap();
        view.poll(&api, &theme()).await;
        assert!(!view.tokens.iter().any(|v| v.id == "stale"));
        let (complete, wait) = tokio::sync::oneshot::channel::<()>();
        view.write = Some(tokio::spawn(async move {
            let _ = wait.await;
            Ok(None)
        }));
        view.key(KeyCode::Char('c'), &api, &theme(), 80, 20);
        assert!(view.input.is_none());
        assert!(view.key(KeyCode::Esc, &api, &theme(), 80, 20));
        assert!(view.busy());
        let _ = complete.send(());
        server.abort();
    }
}

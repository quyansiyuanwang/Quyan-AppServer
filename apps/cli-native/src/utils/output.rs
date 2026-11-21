//! Compact human output; machine output bypasses this renderer entirely.
use serde_json::Value;

pub fn human(value: &Value, locale: &str) -> String {
    let mut lines = Vec::new();
    render(value, locale, 0, &mut lines);
    crate::utils::logging::redact(&lines.join("\n"))
}
fn label(key: &str, locale: &str) -> String {
    if locale == "zh-CN" {
        let text = match key {
            "profile" => "账户",
            "balance" => "余额",
            "usage" => "用量",
            "username" => "用户名",
            "nickname" => "昵称",
            "name" => "名称",
            "status" => "状态",
            "requestCount" => "请求数",
            "totalTokens" => "Tokens",
            "usedQuota" => "已用额度",
            "remainingQuota" => "剩余额度",
            "running" => "运行中",
            "enabled" => "启用",
            "priority" => "优先级",
            "model" => "模型",
            "client" => "客户端",
            "authenticated" => "已登录",
            "total" => "总数",
            "page" => "页码",
            "pageSize" => "每页",
            "changed" => "已变更",
            "backup" => "备份",
            "path" => "路径",
            "baseUrl" => "地址",
            "loggedIn" => "已登录",
            "loggedOut" => "已退出",
            "selected" => "已选用",
            "created" => "已创建",
            "deleted" => "已删除",
            "removed" => "已移除",
            "updated" => "已更新",
            "stopped" => "已停止",
            "reloaded" => "已刷新",
            "dryRun" => "预览",
            "stale" => "状态失效",
            _ => key,
        };
        return text.into();
    }
    key.into()
}
fn hidden(key: &str) -> bool {
    matches!(
        key,
        "token"
            | "accessToken"
            | "refreshToken"
            | "accessKey"
            | "apiKey"
            | "relayToken"
            | "productKey"
            | "replaySigningKey"
            | "controlToken"
            | "credentials"
            | "credential"
            | "credentialStorage"
            | "nextStep"
    )
}
fn scalar(value: &Value, locale: &str) -> String {
    match value {
        Value::Null => "—".into(),
        Value::String(value) => value
            .chars()
            .map(|c| if c.is_control() { ' ' } else { c })
            .collect(),
        Value::Bool(value) if locale == "zh-CN" => if *value { "是" } else { "否" }.into(),
        _ => value.to_string(),
    }
}
fn render(value: &Value, locale: &str, depth: usize, lines: &mut Vec<String>) {
    match value {
        Value::Array(items) => {
            if items.is_empty() {
                lines.push(
                    if locale == "zh-CN" {
                        "暂无数据"
                    } else {
                        "No data"
                    }
                    .into(),
                );
                return;
            }
            if items.iter().all(Value::is_object) {
                let keys: Vec<&str> = [
                    "name",
                    "id",
                    "status",
                    "enabled",
                    "model",
                    "profileId",
                    "priority",
                    "balance",
                    "usedQuota",
                    "requestCount",
                ]
                .into_iter()
                .filter(|key| items.iter().any(|item| item.get(*key).is_some()))
                .collect();
                if !keys.is_empty() {
                    let mut rows = vec![keys
                        .iter()
                        .map(|key| label(key, locale))
                        .collect::<Vec<_>>()];
                    rows.extend(
                        items.iter().map(|item| {
                            keys.iter().map(|key| scalar(&item[*key], locale)).collect()
                        }),
                    );
                    let widths: Vec<usize> = (0..keys.len())
                        .map(|column| {
                            rows.iter()
                                .map(|row| ratatui::text::Line::from(row[column].as_str()).width())
                                .max()
                                .unwrap_or(0)
                        })
                        .collect();
                    for row in rows {
                        lines.push(
                            row.iter()
                                .enumerate()
                                .map(|(i, cell)| {
                                    format!(
                                        "{cell}{}",
                                        " ".repeat(
                                            widths[i].saturating_sub(
                                                ratatui::text::Line::from(cell.as_str()).width()
                                            ) + 2
                                        )
                                    )
                                })
                                .collect::<String>()
                                .trim_end()
                                .into(),
                        );
                    }
                    return;
                }
            }
            for item in items {
                render(item, locale, depth + 1, lines);
            }
        }
        Value::Object(fields) => {
            if let Some(items) = fields.get("items") {
                render(items, locale, depth, lines);
                let total = fields
                    .get("total")
                    .map(|v| scalar(v, locale))
                    .unwrap_or_default();
                let page = fields
                    .get("page")
                    .map(|v| scalar(v, locale))
                    .unwrap_or_default();
                lines.push(format!(
                    "{} {page}  ·  {} {total}",
                    label("page", locale),
                    label("total", locale)
                ));
                return;
            }
            for (key, value) in fields {
                if hidden(key) && !value.is_boolean() {
                    continue;
                }
                if value.is_object() || value.is_array() {
                    lines.push(format!(
                        "{}{}",
                        "  ".repeat(depth.min(2)),
                        label(key, locale)
                    ));
                    render(value, locale, depth + 1, lines);
                } else {
                    lines.push(format!(
                        "{}{}  {}",
                        "  ".repeat(depth.min(2)),
                        label(key, locale),
                        scalar(value, locale)
                    ));
                }
            }
        }
        _ => lines.push(scalar(value, locale)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn human_lists_are_compact_and_hide_secrets() {
        let result = human(
            &json!({"items":[{"id":"fixture","name":"测试","status":1,"token":"sk-rlt-fixture-secret"}],"total":1,"page":1}),
            "zh-CN",
        );
        assert!(result.contains("测试"));
        assert!(result.contains("名称"));
        assert!(!result.contains("secret"));
        assert!(!result.contains('{'));
        assert!(
            !human(&json!({"accessToken":"secret","loggedIn":true}), "en-US").contains("secret")
        );
    }
}

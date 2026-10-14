export type ContentSafetyExportRule = {
  id: string;
  name: string;
  type: string;
  pattern: string;
  direction: string;
  action: string;
  enabled: boolean;
  priority: number;
  source: string;
};
/** Both policy scopes share one wire renderer; callers must authorize and sanitize all inputs first. */
export function renderContentSafetyPolicyExport(
  config: unknown,
  rules: readonly ContentSafetyExportRule[],
  format: "json" | "csv",
  scope: "user" | "system",
) {
  if (format === "csv") {
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const content = [
      "id,name,type,pattern,direction,action,enabled,priority,source",
      ...rules.map((rule) =>
        [
          rule.id,
          rule.name,
          rule.type,
          rule.pattern,
          rule.direction,
          rule.action,
          rule.enabled,
          rule.priority,
          rule.source,
        ]
          .map(escape)
          .join(","),
      ),
    ].join("\n");
    return { format, filename: `content-safety-${scope}.csv`, content };
  }
  const safeConfig = config as Record<string, unknown>;
  return {
    format,
    filename: `content-safety-${scope}.json`,
    content: JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        scope,
        config: { ...safeConfig, aiApiKeyConfigured: Boolean(safeConfig.aiApiKeyConfigured) },
        rules,
      },
      null,
      2,
    ),
  };
}

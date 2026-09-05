import type { ContentSafetyRuleInput } from "@quyan/shared";

// Data used by the explicit administrator import action. Matching always reads the database.
export const DEFAULT_CONTENT_SAFETY_RULES: ContentSafetyRuleInput[] = [
  {
    name: "Environment variables",
    type: "literal",
    pattern: ["process", ".env"].join(""),
    direction: "both",
    action: "unreachable",
  },
  {
    name: "Import meta environment",
    type: "literal",
    pattern: "import.meta.env",
    direction: "both",
    action: "unreachable",
  },
  { name: "Credential files", type: "literal", pattern: "/etc/passwd", direction: "both", action: "unreachable" },
  { name: "Shadow password file", type: "literal", pattern: "/etc/shadow", direction: "both", action: "unreachable" },
  { name: "SSH private key", type: "literal", pattern: ".ssh/id_rsa", direction: "both", action: "unreachable" },
  {
    name: "Environment file access",
    type: "regex",
    pattern:
      "(?:^|[\\s/\\\\])\\.env(?:$|[\\s/\\\\'\"])|(?:^|[\\s/\\\\])\\.env\\.(?:local|production|development|test)(?:$|[\\s/\\\\'\"])",
    direction: "both",
    action: "unreachable",
  },
  { name: "Bearer token", type: "literal", pattern: "bearer token", direction: "both", action: "unreachable" },
  {
    name: "API credential",
    type: "regex",
    pattern: "(api[_ -]?key|secret[_ -]?key|access[_ -]?token)",
    direction: "both",
    action: "unreachable",
  },
  {
    name: "Shell pipe execution",
    type: "regex",
    pattern: "(curl|wget)\\s+[^\\n]{0,500}\\|\\s*(sh|bash)",
    direction: "both",
    action: "unreachable",
  },
  {
    name: "PowerShell encoded command",
    type: "regex",
    pattern: "(powershell|pwsh)[^\\n]{0,200}(-enc|-encodedcommand)",
    direction: "both",
    action: "unreachable",
  },
  {
    name: "Child process execution",
    type: "regex",
    pattern: "child_process\\.(exec|spawn|fork)\\s*\\(",
    direction: "both",
    action: "unreachable",
  },
  {
    name: "Python process execution",
    type: "regex",
    pattern: "(os\\.system|subprocess\\.(run|Popen|call))\\s*\\(",
    direction: "both",
    action: "unreachable",
  },
  {
    name: "Destructive filesystem command",
    type: "regex",
    pattern: "rm\\s+-rf\\s+/",
    direction: "both",
    action: "unreachable",
  },
  {
    name: "Chinese credential access",
    type: "regex",
    pattern: "(读取|获取|导出)(环境变量|密钥|令牌|凭据)",
    direction: "both",
    action: "unreachable",
  },
  {
    name: "Chinese shell execution",
    type: "regex",
    pattern: "执行\\s*(shell|命令|脚本)",
    direction: "both",
    action: "unreachable",
  },
];

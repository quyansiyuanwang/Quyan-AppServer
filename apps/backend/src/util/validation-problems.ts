import type { ZodIssue } from "zod";
import {
  renderDescriptorSafely,
  translateMessage,
  type BackendLocale,
  type MessageKey,
  type TranslationParams,
} from "@/locales";

/**
 * P06 — 统一内部校验模型
 *
 * Zod、TSOA 与业务字段问题先在内部归一为 `ValidationProblem`（字段路径 + 规则 key + 安全参数），
 * 再由响应边界统一渲染成既有的 `fields: Record<string, string[]>` 与顶层摘要。
 *
 * 三条硬规则：
 * 1. 参数只允许**安全领域标量**（长度、范围、枚举名、字段显示名），绝不插入用户提交的值；
 * 2. 不靠解析英文原句推断业务含义——Zod 用结构化 `issue.code`，TSOA 只识别**版本固定的模板文法**，
 *    其余一律回退到安全的「无效值」提示；
 * 3. 呈现限额集中在 `VALIDATION_PRESENTATION`，调用点只消费。
 */

/** 字段级校验规则：每个规则对应一条 `validation.*` 模板 */
export type FieldRule =
  | "required"
  | "invalidType"
  | "tooShort"
  | "tooLong"
  | "tooSmall"
  | "tooLarge"
  | "invalidFormat"
  | "invalidEnum"
  | "unknownField"
  | "invalidValue";

const RULE_MESSAGE_KEYS: Record<FieldRule, MessageKey> = {
  required: "validation.fieldRequired",
  invalidType: "validation.fieldInvalidType",
  tooShort: "validation.fieldTooShort",
  tooLong: "validation.fieldTooLong",
  tooSmall: "validation.fieldTooSmall",
  tooLarge: "validation.fieldTooLarge",
  invalidFormat: "validation.fieldInvalidFormat",
  invalidEnum: "validation.fieldInvalidEnum",
  unknownField: "validation.fieldUnknown",
  invalidValue: "validation.fieldInvalidValue",
};

export interface ValidationProblem {
  /** 安全字段路径，例如 `body.email`、`body.items.0.name` */
  path: string;
  rule: FieldRule;
  /** 仅安全领域标量；不含用户提交值 */
  params?: TranslationParams;
  /**
   * 显式业务描述符（自定义 refine 专用）。
   *
   * 存在时优先于 `rule` 模板，使「具体业务原因」不被通用校验提示覆盖；
   * 未知 key / 缺参仍由 `renderDescriptorSafely` 兜底，不会外泄 key 或占位符。
   */
  descriptor?: { key: MessageKey; params?: TranslationParams };
}

/**
 * 校验呈现策略（单一事实来源）。
 *
 * 顶层摘要只展示前 N 项，超出部分提示查看字段详情；字段路径与枚举展示同样限额，
 * 避免攻击者用超长字段名或超长枚举把响应体撑大。
 */
export const VALIDATION_PRESENTATION = {
  /** 顶层摘要最多展示的问题条数 */
  maxSummaryItems: 3,
  /** 顶层摘要总长上限（字符） */
  maxSummaryLength: 240,
  /** 单个字段路径的长度上限（超出则截断，避免回显超长字段名） */
  maxPathLength: 64,
  /** 枚举允许值在消息里最多展示的个数 */
  maxEnumValues: 8,
  /** 单个字段最多保留的问题条数 */
  maxProblemsPerField: 4,
} as const;

/** 字段显示名的领域映射；键为路径末段（含数组索引会被剥离） */
const FIELD_LABEL_KEYS: Record<string, MessageKey> = {
  username: "validation.fields.username",
  email: "validation.fields.email",
  password: "validation.fields.password",
  name: "validation.fields.name",
  title: "validation.fields.title",
  content: "validation.fields.content",
  code: "validation.fields.code",
  token: "validation.fields.token",
  ip: "validation.fields.ip",
  reason: "validation.fields.reason",
  permission: "validation.fields.permission",
  permissions: "validation.fields.permissions",
};

const UNKNOWN_PATH_PLACEHOLDER = "?";

/**
 * 把内部字段路径规范化成**安全**的展示路径。
 *
 * - 去掉 `body.` / `query.` / `params.` 前缀，数组索引写成 `[]`
 * - 只保留 `[A-Za-z0-9_.[]-]`，其余字符替换为 `?`（防止把任意客户端字符串原样回显）
 * - 超过 `maxPathLength` 则截断
 */
export function normalizeFieldPath(rawPath: string): string {
  const withoutPrefix = rawPath.replace(/^(body|query|params)\./, "");
  const safe = withoutPrefix.replace(/[^A-Za-z0-9_.[\]-]/g, UNKNOWN_PATH_PLACEHOLDER);
  const compact = safe.replace(/\.(\d+)(?=\.|$)/g, "[]");
  if (compact.length <= VALIDATION_PRESENTATION.maxPathLength) return compact;

  return `${compact.slice(0, VALIDATION_PRESENTATION.maxPathLength - 3)}...`;
}

/** 字段显示名：优先领域映射，缺失则回退到安全路径（不回显用户值） */
export function fieldLabel(rawPath: string, locale: BackendLocale): string {
  const normalized = normalizeFieldPath(rawPath);
  const lastSegment = normalized.split(".").pop() ?? normalized;
  const labelKey = FIELD_LABEL_KEYS[lastSegment.toLowerCase()];

  return labelKey ? translateMessage(labelKey, locale) : normalized || UNKNOWN_PATH_PLACEHOLDER;
}

/**
 * 渲染单个问题为字段消息。
 *
 * `{{field}}` 注入的是**字段显示名**（领域映射，缺失则回退到安全路径），
 * 其余参数只有长度/范围/枚举等安全标量——绝不含用户提交值。
 */
export function renderProblemMessage(problem: ValidationProblem, locale: BackendLocale): string {
  // 显式业务描述符优先：具体业务原因不被通用校验提示覆盖
  if (problem.descriptor)
    return renderDescriptorSafely({ key: problem.descriptor.key, params: problem.descriptor.params }, locale).message;

  const params: TranslationParams = { field: fieldLabel(problem.path, locale), ...problem.params };

  return translateMessage(RULE_MESSAGE_KEYS[problem.rule], locale, params as never);
}

/** 按字段分组渲染 `fields`：路径归一化、条数限额，保持既有 `Record<string, string[]>` 形状 */
export function renderValidationFields(
  problems: readonly ValidationProblem[],
  locale: BackendLocale,
): Record<string, string[]> {
  const fields: Record<string, string[]> = {};

  for (const problem of problems) {
    const path = normalizeFieldPath(problem.path) || UNKNOWN_PATH_PLACEHOLDER;
    const messages = fields[path] ?? (fields[path] = []);
    if (messages.length >= VALIDATION_PRESENTATION.maxProblemsPerField) continue;
    messages.push(renderProblemMessage(problem, locale));
  }

  return fields;
}

/**
 * 生成顶层字段摘要：至多 `maxSummaryItems` 项、总长不超过 `maxSummaryLength`。
 *
 * 超出部分不会被丢弃——统一提示「查看字段详情」，用户仍可从 `fields` 取得完整问题。
 */
export function summarizeValidationProblems(problems: readonly ValidationProblem[], locale: BackendLocale): string {
  if (problems.length === 0) return translateMessage("errors.validationFailed", locale);

  const shown: string[] = [];
  let truncated = false;

  for (const problem of problems.slice(0, VALIDATION_PRESENTATION.maxSummaryItems)) {
    const rendered = renderProblemMessage(problem, locale);
    if ([...shown, rendered].join("; ").length > VALIDATION_PRESENTATION.maxSummaryLength) {
      truncated = true;
      break;
    }
    shown.push(rendered);
  }

  if (shown.length === 0) {
    // 单项即超长：退回到通用校验失败提示，绝不为凑摘要而截断出半句话
    return translateMessage("errors.validationFailed", locale);
  }

  if (truncated || problems.length > shown.length) shown.push(translateMessage("validation.summaryMore", locale));

  return shown.join("; ");
}

/** 长度/范围下限参数；刻意用单一职责的小工厂，避免把上限写进 min 槽位这类错误 */
function minParam(min: number): TranslationParams {
  return { min };
}

/** 长度/范围上限参数 */
function maxParam(max: number): TranslationParams {
  return { max };
}

/** 把 Zod issue 归一为统一校验模型；未知 code 一律回退到安全提示 */
export function problemFromZodIssue(issue: ZodIssue, pathPrefix: string): ValidationProblem {
  const path = issue.path.length > 0 ? `${pathPrefix}.${issue.path.join(".")}` : pathPrefix;

  switch (issue.code) {
    case "invalid_type": {
      // 必填缺失（值为 undefined）与类型不符是两类不同的用户问题
      if (issue.received === "undefined" || issue.received === "null") return { path, rule: "required" };
      return { path, rule: "invalidType", params: { expected: issue.expected } };
    }
    case "too_small": {
      const limit = typeof issue.minimum === "bigint" ? Number(issue.minimum) : issue.minimum;
      // 数值型是「范围」问题，字符串/数组是「长度」问题
      if (issue.type === "number" || issue.type === "bigint" || issue.type === "date")
        return { path, rule: "tooSmall", params: minParam(limit) };
      return { path, rule: "tooShort", params: minParam(limit) };
    }
    case "too_big": {
      const limit = typeof issue.maximum === "bigint" ? Number(issue.maximum) : issue.maximum;
      if (issue.type === "number" || issue.type === "bigint" || issue.type === "date")
        return { path, rule: "tooLarge", params: maxParam(limit) };
      return { path, rule: "tooLong", params: maxParam(limit) };
    }
    case "invalid_string":
      return { path, rule: "invalidFormat" };
    case "invalid_enum_value": {
      const values = (issue.options ?? []).slice(0, VALIDATION_PRESENTATION.maxEnumValues).map(String);
      return { path, rule: "invalidEnum", params: values.length > 0 ? { values: values.join(", ") } : undefined };
    }
    case "invalid_literal":
      return { path, rule: "invalidValue" };
    case "unrecognized_keys":
      // issue.keys 来自请求，可能被构造为超长/异常字符；只取首项并强制安全化
      return { path: issue.keys[0] ? `${pathPrefix}.${issue.keys[0]}` : path, rule: "unknownField" };
    case "invalid_union":
    case "invalid_arguments":
    case "invalid_return_type":
    case "not_multiple_of":
    case "not_finite":
      return { path, rule: "invalidValue" };
    default:
      // `custom` 与未来新增 code：不解析 message 文本。
      // 需要具体业务原因时，refine 必须通过 `params` 显式携带描述符。
      if (issue.code === "custom") {
        const descriptor = descriptorFromRefinement(issue.params);
        if (descriptor)
          return {
            path,
            rule: "invalidValue",
            descriptor: { key: descriptor.messageKey as MessageKey, params: descriptor.messageParams },
          };
      }
      return { path, rule: "invalidValue" };
  }
}

/**
 * TSOA 字段错误 → 统一校验模型。
 *
 * TSOA 没有暴露结构化 validator 元数据，其 message 由**版本固定的模板文法**生成
 * （见 `@tsoa/runtime` `templateHelpers`）。这里只识别这些模板形状并提取**安全标量**
 * （长度/范围/枚举名），无法识别的一律回退到「无效值」——因此开发者自定义的 `errorMsg`
 * 与任何可能内嵌用户值的文本都不会被透传。
 */
const TSOA_TEMPLATES: ReadonlyArray<{
  pattern: RegExp;
  build: (match: RegExpMatchArray) => ValidationProblem["rule"] | null;
  params?: (m: RegExpMatchArray) => TranslationParams;
}> = [
  // TSOA 实际模板为 `'<name>' is required`；同时接受无引号形式（不同版本/手写夹具）。
  // 该模式只承载「必填」语义，不捕获也不回显任何用户输入。
  { pattern: /^(?:'[^']*'|\S+) is required$/, build: () => "required" },
  { pattern: /^invalid string value$/, build: () => "invalidType", params: () => ({ expected: "string" }) },
  { pattern: /^invalid integer number$/, build: () => "invalidType", params: () => ({ expected: "integer" }) },
  { pattern: /^invalid float number$/, build: () => "invalidType", params: () => ({ expected: "number" }) },
  { pattern: /^invalid boolean value$/, build: () => "invalidType", params: () => ({ expected: "boolean" }) },
  { pattern: /^invalid array$/, build: () => "invalidType", params: () => ({ expected: "array" }) },
  { pattern: /^invalid undefined value$/, build: () => "required" },
  { pattern: /^invalid object$/, build: () => "invalidValue" },
  { pattern: /^minLength (\d+)$/, build: () => "tooShort", params: (m) => minParam(Number(m[1])) },
  { pattern: /^maxLength (\d+)$/, build: () => "tooLong", params: (m) => maxParam(Number(m[1])) },
  { pattern: /^minItems (\d+)$/, build: () => "tooShort", params: (m) => minParam(Number(m[1])) },
  { pattern: /^maxItems (\d+)$/, build: () => "tooLong", params: (m) => maxParam(Number(m[1])) },
  { pattern: /^min (-?\d+(?:\.\d+)?)$/, build: () => "tooSmall", params: (m) => minParam(Number(m[1])) },
  { pattern: /^max (-?\d+(?:\.\d+)?)$/, build: () => "tooLarge", params: (m) => maxParam(Number(m[1])) },
  { pattern: /^required unique array$/, build: () => "invalidValue" },
  { pattern: /^no member$/, build: () => "invalidEnum" },
  { pattern: /^invalid ISO 8601 date/, build: () => "invalidFormat" },
  { pattern: /^invalid ISO 8601 datetime/, build: () => "invalidFormat" },
];

export function problemFromTsoaField(field: string, message: string | undefined): ValidationProblem {
  const path = field;

  if (typeof message === "string")
    for (const template of TSOA_TEMPLATES) {
      const match = message.match(template.pattern);
      if (!match) continue;

      const rule = template.build(match);
      if (!rule) break;
      return { path, rule, params: template.params?.(match) };
    }

  // 模板无法识别（含自定义 errorMsg、或 TSOA 未来变更模板）：只给安全的字段级提示
  return { path, rule: "invalidValue" };
}

/** 枚举类 TSOA 模板单独处理：成员列表由 schema 生成，属安全的领域取值 */
export function problemFromTsoaEnumField(field: string, message: string | undefined): ValidationProblem | undefined {
  if (typeof message !== "string") return undefined;
  const match = message.match(/^should be one of the following; \[(.*)]$/);
  if (!match) return undefined;

  const values = match[1]
    .split(",")
    .map((value) => value.trim().replace(/^'|'$/g, ""))
    .filter((value) => value.length > 0)
    .slice(0, VALIDATION_PRESENTATION.maxEnumValues);

  return {
    path: field,
    rule: "invalidEnum",
    params: values.length > 0 ? { values: values.join(", ") } : undefined,
  };
}

/**
 * 从 Zod refinement 的 `params` 里提取**显式**业务描述符。
 *
 * 自定义 refine 若需要展示具体业务原因，必须这样显式携带描述符，而不是把中文/英文句子
 * 写进 `message` 让后端去猜。
 */
export interface RefinementDescriptorParams {
  messageKey?: string;
  messageParams?: TranslationParams;
}

export function descriptorFromRefinement(
  params: unknown,
): { messageKey: string; messageParams?: TranslationParams } | undefined {
  if (!params || typeof params !== "object") return undefined;
  const candidate = params as RefinementDescriptorParams;
  if (typeof candidate.messageKey !== "string" || candidate.messageKey.length === 0) return undefined;

  return { messageKey: candidate.messageKey, messageParams: candidate.messageParams };
}

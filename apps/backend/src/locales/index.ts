import en from "./en";
import zhCN from "./zh-CN";
import type {
  Assert,
  DeepStringify,
  DescriptorRestArgs,
  Equal,
  ExtractDoubleBraceKeys,
  NestedKeys,
  ParamsForKey,
  PathValue,
  TranslationParams,
} from "./types";

export type { TranslationParams, MessageParamValue } from "./types";

export const SUPPORTED_BACKEND_LOCALES = ["zh-CN", "en"] as const;
export type BackendLocale = (typeof SUPPORTED_BACKEND_LOCALES)[number];

export const DEFAULT_BACKEND_LOCALE: BackendLocale = "en";
export const LOCALE_HEADER_NAME = "x-locale";

type BackendMessages = typeof en;
type LocaleMessages = DeepStringify<BackendMessages>;
export type MessageKey = NestedKeys<BackendMessages>;
type EnKeys = NestedKeys<typeof en>;
type ZhCNKeys = NestedKeys<typeof zhCN>;
type _AssertLocaleKeys = Assert<Equal<EnKeys, ZhCNKeys>>;

/**
 * 某个 key 在给定语言目录中的模板占位符集合（按 key 分发，联合 key 取并集）。
 */
type PlaceholdersForKey<TMessages, TKey extends string> = TKey extends unknown
  ? ExtractDoubleBraceKeys<Extract<PathValue<TMessages, TKey>, string>>
  : never;

/**
 * 占位符一致性硬约束：同一个 key 在 en 与 zh-CN 中必须使用相同的占位符集合。
 *
 * 若译文写成 `{{ip}}` 而英文是 `{{IP}}`（或漏写/多写占位符），插值时就会渲染出空值或残留
 * `{{...}}`。这条断言让不一致在 `tsc` 阶段失败，而不是等到线上。
 *
 * 刻意逐 key 比较后再断言结果为 `never`：直接对两个映射类型做整体 `Equal` 会因类型仍处于
 * 延迟求值状态而误判为不相等；逐 key 形式还会在报错信息里列出**具体是哪些 key** 不一致。
 */
type PlaceholderMismatches = {
  [K in MessageKey]: Equal<PlaceholdersForKey<BackendMessages, K>, PlaceholdersForKey<typeof zhCN, K>> extends true
    ? never
    : K;
}[MessageKey];
/** 约束为 `never`，使报错信息直接列出占位符不一致的具体 key */
type AssertNever<T extends never> = T;
type _AssertLocalePlaceholders = AssertNever<PlaceholderMismatches>;

/**
 * 某个 key 的精确参数类型。
 *
 * - 字面量 key → 该模板占位符的精确记录（无占位符时为 `undefined`）
 * - 已退化为整个 `MessageKey` 联合 → 宽松 `TranslationParams`，避免展开数百个 key
 */
export type MessageParamsForKey<TKey extends MessageKey> = MessageKey extends TKey
  ? TranslationParams | undefined
  : ParamsForKey<BackendMessages, TKey>;

/** 某个 key 对参数的要求，用于把「必须传参 / 不接受参数」落到编译期 */
export type MessageRequirementForKey<TKey extends MessageKey> = MessageKey extends TKey
  ? "loose"
  : [Exclude<MessageParamsForKey<TKey>, undefined>] extends [never]
    ? "forbidden"
    : "required";

type DescriptorArgs<TKey extends MessageKey> = DescriptorRestArgs<
  MessageRequirementForKey<TKey>,
  MessageParamsForKey<TKey>
>;

void (0 as unknown as _AssertLocaleKeys);
void (0 as unknown as _AssertLocalePlaceholders);

const catalogs = {
  en,
  "zh-CN": zhCN,
} satisfies Record<BackendLocale, LocaleMessages>;

export interface MessageDescriptor<TKey extends MessageKey = MessageKey> {
  key: TKey;
  params?: TranslationParams;
  fallback?: string;
}

/** 描述符在运行时暴露的问题；出口据此回退并记录受控诊断，不向用户展示 key 或残留占位符 */
export interface MessageDescriptorIssue {
  kind: "unknownKey" | "missingParam" | "unusableFallback";
  key: string;
  detail: string;
}

export type MessageErrorOptions<TKey extends MessageKey = MessageKey> =
  MessageRequirementForKey<TKey> extends "required"
    ? { messageKey: TKey; messageParams: MessageParamsForKey<TKey> }
    : { messageKey: TKey; messageParams?: MessageParamsForKey<TKey> };

function getNestedMessage(catalog: LocaleMessages, key: MessageKey): string | undefined {
  const value = key.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, catalog);

  return typeof value === "string" ? value : undefined;
}

const PLACEHOLDER_PATTERN = /\{\{\s*([^{}\s]+)\s*\}\}/g;

function extractPlaceholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]);
}

/**
 * 创建类型安全的消息描述符。
 *
 * 编译期约束：带占位符的 key 必须提供匹配参数；无占位符的 key 不接受参数。
 */
export function createMessageDescriptor<TKey extends MessageKey>(
  key: TKey,
  ...rest: DescriptorArgs<TKey>
): MessageDescriptor<TKey> {
  const [params, fallback] = rest as [TranslationParams | undefined, string | undefined];
  return { key, params, fallback };
}

/**
 * 创建类型安全的错误消息选项，供 `ApiErrorOptions` 与调用链复用。
 *
 * 与 `createMessageDescriptor` 使用同一套 key/params 约束，避免出现第二套弱类型入口。
 */
export function createMessageOptions<TKey extends MessageKey>(
  key: TKey,
  ...rest: DescriptorArgs<TKey>
): MessageErrorOptions<TKey> {
  const [params] = rest as [TranslationParams | undefined];
  return { messageKey: key, messageParams: params } as MessageErrorOptions<TKey>;
}

export function normalizeBackendLocale(locale?: string | null): BackendLocale {
  if (!locale) return DEFAULT_BACKEND_LOCALE;

  const normalized = locale.trim();
  if (!normalized) return DEFAULT_BACKEND_LOCALE;
  if (normalized === "zh-CN" || normalized.toLowerCase() === "zh-cn") return "zh-CN";
  if (normalized === "en" || normalized.toLowerCase().startsWith("en")) return "en";

  return DEFAULT_BACKEND_LOCALE;
}

export function translateMessage<TKey extends MessageKey>(
  key: TKey,
  locale: BackendLocale,
  params?: MessageParamsForKey<TKey>,
  fallback?: string,
): string {
  const template =
    getNestedMessage(catalogs[locale], key) ??
    getNestedMessage(catalogs[DEFAULT_BACKEND_LOCALE], key) ??
    fallback ??
    key;
  if (!params) return template;

  let values: TranslationParams | undefined;
  if (params) values = params as TranslationParams;

  return template.replace(PLACEHOLDER_PATTERN, (_match, token: string) => {
    const value = values?.[token];
    return value === undefined || value === null ? "" : String(value);
  });
}

export function translateDescriptor(descriptor: MessageDescriptor, locale: BackendLocale): string {
  return translateMessage(descriptor.key, locale, descriptor.params, descriptor.fallback);
}

/**
 * 检查描述符在运行时可安全渲染，返回问题清单而不抛异常。
 *
 * 调用方（响应出口）据此记录受控诊断并回退，绝不把消息 key 或 `{{param}}` 残留展示给用户。
 */
export function inspectMessageDescriptor(descriptor: MessageDescriptor): MessageDescriptorIssue[] {
  const issues: MessageDescriptorIssue[] = [];
  const template = getNestedMessage(catalogs[DEFAULT_BACKEND_LOCALE], descriptor.key);

  if (template === undefined) {
    issues.push({
      kind: "unknownKey",
      key: descriptor.key,
      detail: "Message key is not present in the default catalog",
    });
    return issues;
  }

  for (const placeholder of extractPlaceholders(template)) {
    const value = descriptor.params?.[placeholder];
    if (value === undefined || value === null)
      issues.push({
        kind: "missingParam",
        key: descriptor.key,
        detail: `Missing value for placeholder "${placeholder}"`,
      });
  }

  return issues;
}

export interface RenderedMessage {
  message: string;
  issues: MessageDescriptorIssue[];
  /** 是否使用了安全兜底（真实 key / 缺失参数被替换为通用安全消息） */
  usedSafeFallback: boolean;
}

/**
 * 渲染描述符并在运行时异常时使用安全本地化兜底。
 *
 * 未知 key 或缺失参数不会把 key、占位符或原始异常暴露给用户，而是回退到通用安全消息。
 */
export function renderDescriptorSafely(descriptor: MessageDescriptor, locale: BackendLocale): RenderedMessage {
  const issues = inspectMessageDescriptor(descriptor);
  if (issues.length === 0) return { message: translateDescriptor(descriptor, locale), issues, usedSafeFallback: false };

  return {
    message: translateMessage("errors.internalServerError", locale),
    issues,
    usedSafeFallback: true,
  };
}

export const backendI18n = {
  t: translateMessage,
  descriptor: createMessageDescriptor,
  errorOptions: createMessageOptions,
  inspect: inspectMessageDescriptor,
  renderSafely: renderDescriptorSafely,
} as const;

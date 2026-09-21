/**
 * P04 — 消息目录按领域整理：一致性、单一事实来源与运行时安全兜底
 *
 * 覆盖计划 §3.1 与 P04 完成标准：
 * 1. **中英文 key 与占位符一致**：既有编译期断言（`_AssertLocaleKeys`、`_AssertLocalePlaceholders`）
 *    在 `tsc` 阶段拦截；本文件提供运行时镜像，使不一致在测试层也能定位到具体 key。
 * 2. **无重复事实源**：同一业务域内不允许出现两条文案完全相同的 key；
 *    跨域同文案必须显式登记（域边界复用是有意的，但必须是清醒决策）。
 * 3. **运行时安全兜底**：每个 key 都能在两种语言下干净渲染——不残留 `{{...}}`、
 *    不回退到安全消息、不回显 key 本身。
 * 4. **遗留原文反查目录只能收缩**：该目录是 F01 的旧机制，禁止新增条目（P13 删除）。
 */
import { describe, expect, it } from "vitest";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import {
  DEFAULT_BACKEND_LOCALE,
  SUPPORTED_BACKEND_LOCALES,
  getLegacyRawMessageEntries,
  inspectMessageDescriptor,
  renderDescriptorSafely,
  translateMessage,
  type BackendLocale,
  type MessageKey,
} from "@/locales";

type Catalog = Record<string, unknown>;

function flatten(catalog: Catalog, prefix = ""): Map<string, string> {
  const entries = new Map<string, string>();

  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") entries.set(path, value);
    else if (value && typeof value === "object")
      for (const [nestedKey, nestedValue] of flatten(value as Catalog, path)) entries.set(nestedKey, nestedValue);
  }

  return entries;
}

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)].map((match) => match[1]).sort();
}

function domainOf(key: string): string {
  return key.split(".")[0];
}

/** 同一文案在多个 key 上重复的分组（仅统计重复组，不统计单条 key） */
function duplicateTextGroups(entries: Map<string, string>): Array<{ text: string; keys: string[] }> {
  const byText = new Map<string, string[]>();
  for (const [key, value] of entries) byText.set(value, [...(byText.get(value) ?? []), key]);

  return [...byText.entries()].filter(([, keys]) => keys.length > 1).map(([text, keys]) => ({ text, keys }));
}

/**
 * 跨域同文案的已登记清单（清醒决策过的域边界复用）。
 *
 * 新增跨域重复会让本测试失败——若确认是有意的域边界复用，请把新的分组加入此清单；
 * 若只是同一事实的第二次定义，应复用既有 key 而不是新建（见 AGENTS.md「先复用或推导，再新增定义」）。
 *
 * P08：RAM 的 5 组镜像 key（`ram.userNotFound` / `ram.groupNotFound` / `ram.actorNotFound` /
 * `ram.invalidPermissions` / `ram.usernameExists`）已收敛到既有 key，本清单相应缩小；
 * 用户名唯一性统一由 `user.usernameExists` 承担。
 */
const KNOWN_CROSS_DOMAIN_SAME_TEXT: readonly (readonly string[])[] = [
  ["user.notFound", "permission.userNotFound"],
  ["user.emailChangeCodeSent", "auth.verificationCodeSent"],
  ["user.deleted", "group.deleted", "billing.redemptionCodeDeleted"],
  ["group.notFound", "permission.groupNotFound"],
  ["group.cannotModifyPermissionsForPeer", "permission.cannotModifyPeerGroup"],
  ["errors.forbidden", "permission.insufficientPermission"],
];

const SAMPLE_VALUE = "<v>";

/** 遗留原文反查目录的基线（只允许收缩）：P04 实测值 */
const LEGACY_RAW_BASELINE = { en: 144, "zh-CN": 144 } satisfies Record<BackendLocale, number>;
const LEGACY_PENDING_BASELINE = { en: 143, "zh-CN": 99 } satisfies Record<BackendLocale, number>;

const catalogs: Record<BackendLocale, Map<string, string>> = {
  en: flatten(en as Catalog),
  "zh-CN": flatten(zhCN as Catalog),
};

describe("P04 · 目录结构与 key 一致性", () => {
  it("exposes exactly one catalog per supported locale with identical key sets", () => {
    expect(Object.keys(catalogs).sort()).toEqual([...SUPPORTED_BACKEND_LOCALES].sort());

    const enKeys = [...catalogs.en.keys()].sort();
    const zhKeys = [...catalogs["zh-CN"].keys()].sort();

    expect(zhKeys).toEqual(enKeys);
    expect(enKeys.length).toBeGreaterThan(100);
  });

  it("keeps the catalog organised by business domain", () => {
    const domains = [...new Set([...catalogs.en.keys()].map(domainOf))].sort();

    expect(domains).toEqual(
      [
        "agent",
        "auth",
        "billing",
        "common",
        "errors",
        "group",
        "ipBlacklist",
        "oauth",
        "permission",
        "ram",
        "relay",
        "system",
        "user",
        "validation",
        "legalPolicy",
        "accessKey",
        "ipWhitelist",
        "impersonation",
        "developerProject",
        "developerProduct",
      ].sort(),
    );
  });

  it("keeps key nesting at domain.key except for the registered sub-groups", () => {
    // 约定：绝大多数 key 是两层 `domain.key`。限流原因族与 P06 的字段显示名映射按
    // `domain.subgroup.key` 归组，属于已登记的合理三层结构；除此之外新增更深的嵌套
    // 必须走这里登记（避免目录逐渐长成树）。
    const REGISTERED_NESTED_KEYS = [
      "auth.rateLimit.email",
      "auth.rateLimit.ip",
      "auth.twoFactorEmailRateLimit.challenge",
      "auth.twoFactorEmailRateLimit.ip",
      "auth.twoFactorRateLimit.challenge",
      "auth.twoFactorRateLimit.ip",
      "validation.fields.code",
      "validation.fields.content",
      "validation.fields.email",
      "validation.fields.ip",
      "validation.fields.name",
      "validation.fields.password",
      "validation.fields.permission",
      "validation.fields.permissions",
      "validation.fields.reason",
      "validation.fields.title",
      "validation.fields.token",
      "validation.fields.username",
    ];

    const nested = [...catalogs.en.keys()].filter((key) => key.split(".").length !== 2).sort();

    expect(nested).toEqual(REGISTERED_NESTED_KEYS);
    for (const key of catalogs.en.keys()) expect(key.split(".").length).toBeLessThanOrEqual(3);
  });

  it("uses the same placeholders in both locales for every key", () => {
    const mismatches: Array<{ key: string; en: string[]; zhCN: string[] }> = [];

    for (const [key, template] of catalogs.en) {
      const other = catalogs["zh-CN"].get(key) as string;
      const a = placeholders(template);
      const b = placeholders(other);
      if (a.join(",") !== b.join(",")) mismatches.push({ key, en: a, zhCN: b });
    }

    expect(mismatches).toEqual([]);
  });

  it("defaults to en and normalizes every supported locale", () => {
    expect(DEFAULT_BACKEND_LOCALE).toBe("en");
    for (const locale of SUPPORTED_BACKEND_LOCALES) expect(translateMessage("common.success", locale)).toBeTruthy();
  });
});

describe("P04 · 无重复事实源", () => {
  it("has no two keys with identical text inside the same domain", () => {
    const intraDomain: Array<{ text: string; keys: string[] }> = [];

    for (const [locale, entries] of Object.entries(catalogs))
      for (const group of duplicateTextGroups(entries)) {
        const domains = new Set(group.keys.map(domainOf));
        if (domains.size < group.keys.length) intraDomain.push({ text: `[${locale}] ${group.text}`, keys: group.keys });
      }

    expect(intraDomain).toEqual([]);
  });

  it("only reuses the same text across domains when the group is registered", () => {
    const registered = new Set(KNOWN_CROSS_DOMAIN_SAME_TEXT.map((group) => [...group].sort().join(" | ")));
    const unregistered: string[] = [];

    for (const [locale, entries] of Object.entries(catalogs))
      for (const group of duplicateTextGroups(entries)) {
        const signature = [...group.keys].sort().join(" | ");
        if (!registered.has(signature)) unregistered.push(`[${locale}] ${group.text} → ${signature}`);
      }

    expect(unregistered).toEqual([]);
  });

  it("keeps the legacy raw-message dictionary shrinking-only", () => {
    for (const locale of SUPPORTED_BACKEND_LOCALES) {
      const raw = getLegacyRawMessageEntries(locale);
      expect(raw.length).toBeLessThanOrEqual(LEGACY_RAW_BASELINE[locale]);

      const catalogValues = new Set(catalogs[locale].values());
      const pending = raw.filter((entry) => !catalogValues.has(entry));
      expect(pending.length).toBeLessThanOrEqual(LEGACY_PENDING_BASELINE[locale]);
    }
  });

  it("keeps both legacy dictionaries keyed identically", () => {
    expect([...getLegacyRawMessageEntries("en")].sort()).toEqual([...getLegacyRawMessageEntries("zh-CN")].sort());
  });
});

describe("P04 · 全目录干净渲染与运行时安全兜底", () => {
  it("renders every key in both locales without residual placeholders", () => {
    const failures: string[] = [];

    for (const [key, template] of catalogs.en) {
      const params = Object.fromEntries(placeholders(template).map((name) => [name, SAMPLE_VALUE]));

      for (const locale of SUPPORTED_BACKEND_LOCALES) {
        const rendered = translateMessage(key as MessageKey, locale, params as never);

        if (rendered.includes("{{") || rendered.includes("}}"))
          failures.push(`[${locale}] ${key}: residual placeholder in ${JSON.stringify(rendered)}`);
        if (rendered.trim().length === 0) failures.push(`[${locale}] ${key}: empty message`);
        if (rendered === key) failures.push(`[${locale}] ${key}: fell back to the key itself`);
        for (const name of placeholders(template))
          if (!rendered.includes(SAMPLE_VALUE))
            failures.push(
              `[${locale}] ${key}: placeholder ${name} was not interpolated in ${JSON.stringify(rendered)}`,
            );
      }
    }

    expect(failures).toEqual([]);
  });

  it("passes runtime descriptor inspection for every key in both locales", () => {
    const failures: string[] = [];

    for (const [key, template] of catalogs.en) {
      const params = Object.fromEntries(placeholders(template).map((name) => [name, SAMPLE_VALUE]));

      for (const locale of SUPPORTED_BACKEND_LOCALES) {
        const rendered = renderDescriptorSafely({ key: key as MessageKey, params }, locale);
        if (rendered.issues.length > 0) failures.push(`[${locale}] ${key}: ${JSON.stringify(rendered.issues)}`);
        if (rendered.usedSafeFallback) failures.push(`[${locale}] ${key}: used safe fallback`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("reports issues instead of rendering when params are withheld", () => {
    const key: MessageKey = "ipBlacklist.notFoundByIp";

    expect(inspectMessageDescriptor({ key })).toEqual([
      { kind: "missingParam", key, detail: 'Missing value for placeholder "ip"' },
    ]);

    const rendered = renderDescriptorSafely({ key }, "zh-CN");
    expect(rendered.usedSafeFallback).toBe(true);
    expect(rendered.message).toBe(translateMessage("errors.internalServerError", "zh-CN"));
    expect(rendered.message).not.toContain("{{");
    expect(rendered.message).not.toContain(key);
  });
});

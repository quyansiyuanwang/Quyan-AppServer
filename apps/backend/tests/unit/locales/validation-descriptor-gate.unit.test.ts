import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 门禁：Zod 的 `custom` 校验问题必须携带消息描述符。
 *
 * 背景：`src/util/validation-problems.ts` **刻意不解析** `issue.message` 文本
 * （避免把可能内嵌用户值的文本透传给用户），只认 `issue.params.messageKey`。
 * 因此一个 `addIssue({ code: z.ZodIssueCode.custom, message: "…" })` 如果没有
 * `params`，它的具体业务原因会在出口被替换成通用
 * `{{field}} has an invalid value`——例如「查询时间范围不能超过 30 天」变成
 * 「endTime 值无效」。
 *
 * 这正是本次重构中真实发生过的一次回归：69 处 custom 校验丢了原因，而当时
 * 没有任何测试或检查发现它，直到跑集成测试才暴露。本文件把该性质固定下来。
 */

const SRC = new URL("../../../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** 从 index 处的 `{` 开始，返回配对 `}` 的下标 */
function matchBrace(text: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    const prev = text[i - 1];
    if (inString) {
      if (ch === inString && prev !== "\\") inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 收集全部 `addIssue({ … })` 块，并判断是否携带描述符 */
export function collectCustomIssuesWithoutDescriptor() {
  const offenders: { file: string; line: number }[] = [];

  for (const file of walk(SRC)) {
    if (file.includes(`${sep}build${sep}`)) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/addIssue\s*\(/g)) {
      const openIndex = match.index + match[0].length - 1;
      const closeIndex = matchBrace(text, openIndex, "(", ")");
      if (closeIndex < 0) continue;
      const block = text.slice(openIndex + 1, closeIndex);
      if (!/ZodIssueCode\.custom/.test(block)) continue;
      // 携带描述符：字面量 key，或 helper 里的简写转发 `params: { messageKey }`
      if (/messageKey\s*:|[{,]\s*messageKey\s*[,}\s]/.test(block)) continue;
      offenders.push({
        file: relative(SRC, file).split(sep).join("/"),
        line: text.slice(0, match.index).split("\n").length,
      });
    }
  }

  return offenders;
}

describe("custom zod validation issues carry a message descriptor", () => {
  it("has no custom issue without params.messageKey", () => {
    expect(collectCustomIssuesWithoutDescriptor()).toEqual([]);
  });

  it("detects a custom issue that lost its descriptor (self-check)", () => {
    // 自检：证明判据本身有效（构造一段无描述符的样例并断言会被识别）
    const sample = `
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "query time range must not exceed 30 days",
      });
    `;
    const match = sample.match(/addIssue\s*\(/);
    const openIndex = (match?.index ?? 0) + "addIssue(".length - 1;
    const closeIndex = matchBrace(sample, openIndex, "(", ")");
    const block = sample.slice(openIndex + 1, closeIndex);
    expect(/ZodIssueCode\.custom/.test(block)).toBe(true);
    expect(/messageKey\s*:/.test(block)).toBe(false);

    const described = sample.replace(
      'message: "query time range must not exceed 30 days",',
      'message: "…",\n        params: { messageKey: "billing.transactionQueryRangeTooWide" },',
    );
    const match2 = described.match(/addIssue\s*\(/);
    const open2 = (match2?.index ?? 0) + "addIssue(".length - 1;
    const block2 = described.slice(open2 + 1, matchBrace(described, open2, "(", ")"));
    expect(/messageKey\s*:/.test(block2)).toBe(true);
  });
});

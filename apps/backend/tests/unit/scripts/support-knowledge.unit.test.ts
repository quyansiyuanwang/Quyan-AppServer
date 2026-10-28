import { describe, expect, it } from "vitest";
import {
  IAM_ACTION_DEFINITIONS,
  IAM_CONDITION_KEY_CATALOG,
  IAM_RESOURCE_TYPE_CATALOG,
  SUPPORT_KNOWLEDGE_SECTION_CHARACTERS,
} from "@quyan/shared";
import {
  cleanKnowledgeMarkdown,
  iamKnowledgeSections,
  iamKnowledgeSearchText,
  splitKnowledgeSections,
} from "../../../../docs-site/scripts/support-knowledge";

describe("customer support IAM knowledge", () => {
  it("preserves literal JSON, wildcard, underscore, ARN and inline syntax", () => {
    const document = {
      Version: "1",
      Statement: [{ Effect: "Allow", Action: "quyan:ram:ReadUser", Resource: "acs:quyan:*:account_id:user/user_id" }],
    };
    const json = JSON.stringify(document, null, 2);
    const markdown = `# IAM\n**Policy**\n\`\`\`json\n${json}\n\`\`\`\nUse \`*\`, \`user_id\` and \`acs:quyan:*:account_id:user/*\`.`;
    const text = cleanKnowledgeMarkdown(markdown);
    expect(text).toContain(json);
    expect(text).toContain("Use *, user_id and acs:quyan:*:account_id:user/*.");
    expect(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1))).toEqual(document);
  });
  it("splits even heading-free and long content to the exact existing read budget", () => {
    const sections = splitKnowledgeSections(`\`\`\`json\n${"x".repeat(3500)}\n\`\`\`\n# not code\ncontent`, "fallback");
    expect(sections.length).toBeGreaterThan(3);
    for (const section of sections)
      expect(section.content.length).toBeLessThanOrEqual(SUPPORT_KNOWLEDGE_SECTION_CHARACTERS);
    expect(splitKnowledgeSections("y".repeat(3000), "no heading")).toHaveLength(3);
  });
  it.each(["en", "zh-CN"] as const)("derives the complete %s catalog with no invented or removed Action", (locale) => {
    const sections = iamKnowledgeSections(locale);
    for (const section of sections)
      expect(section.content.length).toBeLessThanOrEqual(SUPPORT_KNOWLEDGE_SECTION_CHARACTERS);
    for (const action of IAM_ACTION_DEFINITIONS) {
      const fragments = sections.filter((section) => section.heading.includes(` / ${action.action} [`));
      expect(JSON.parse(fragments.map((part) => part.content).join("\n"))).toEqual(action);
    }
    for (const resource of IAM_RESOURCE_TYPE_CATALOG)
      expect(sections.some((section) => section.content.includes(JSON.stringify(resource.arnTemplate)))).toBe(true);
    for (const condition of IAM_CONDITION_KEY_CATALOG)
      expect(sections.some((section) => section.content.includes(JSON.stringify(condition.key)))).toBe(true);
    const search = iamKnowledgeSearchText();
    for (const action of IAM_ACTION_DEFINITIONS) expect(search).toContain(action.action);
    expect(search).not.toContain("GeneratePolicyDraft");
    expect(search).not.toContain("alidns:");
    expect(sections.map((section) => section.content).join("\n")).not.toContain("GeneratePolicyDraft");
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_CONTENT_SAFETY_RULES } from "@/util/content-safety-defaults";
import { ContentSafetyService } from "@/services/system/content-safety.service";

const CONTROL_CHARS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}\\u200b-\\u200f\\u202a-\\u202e\\u2060\\u2066-\\u2069]`,
  "g",
);
const normalize = (value: string) => value.normalize("NFKC").replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();

describe("content safety rule data", () => {
  it("ships high-confidence defaults as importable data", () => {
    expect(DEFAULT_CONTENT_SAFETY_RULES.length).toBeGreaterThan(10);
    expect(DEFAULT_CONTENT_SAFETY_RULES.some((rule) => rule.pattern === "process.env")).toBe(true);
    expect(DEFAULT_CONTENT_SAFETY_RULES.every((rule) => rule.action === "unreachable")).toBe(true);
  });

  it("normalizes unicode and zero-width characters before matching", () => {
    expect(normalize("ｐｒｏｃｅｓｓ.ｅｎｖ\u200b")).toBe("process.env");
  });

  it("does not treat an example environment template as a secret file", () => {
    const rule = DEFAULT_CONTENT_SAFETY_RULES.find((item) => item.name === "Environment file access");
    expect(rule?.type).toBe("regex");
    const expression = new RegExp(rule!.pattern, "iu");
    expect(expression.test("Please create a .env.example template with placeholder values.")).toBe(false);
    expect(expression.test("cat .env.production")).toBe(true);
    expect(expression.test("cat .env")).toBe(true);
  });

  it("keeps legacy literal .env rules from matching .env.example", () => {
    const service = Object.create(ContentSafetyService.prototype) as ContentSafetyService;
    const matchRule = (service as any).matchRule.bind(service);
    expect(
      matchRule("create a .env.example template", [
        { id: "legacy", type: "literal", pattern: ".env", direction: "both", action: "unreachable", priority: 1 },
      ]),
    ).toBeNull();
    expect(
      matchRule("cat .env", [
        { id: "legacy", type: "literal", pattern: ".env", direction: "both", action: "unreachable", priority: 1 },
      ]),
    ).not.toBeNull();
  });

  it("rejects regexes that can match empty text", () => {
    expect(new RegExp("secret", "iu").test("")).toBe(false);
    expect(new RegExp(".*", "iu").test("")).toBe(true);
  });
});

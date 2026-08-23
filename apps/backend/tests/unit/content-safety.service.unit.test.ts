import { describe, expect, it } from "vitest";
import { DEFAULT_CONTENT_SAFETY_RULES } from "@/util/content-safety-defaults";

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

  it("rejects regexes that can match empty text", () => {
    expect(new RegExp("secret", "iu").test("")).toBe(false);
    expect(new RegExp(".*", "iu").test("")).toBe(true);
  });
});

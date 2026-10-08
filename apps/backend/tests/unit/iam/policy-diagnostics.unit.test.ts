import { describe, it, expect } from "vitest";
import { diagnoseIamPolicy } from "@/iam/diagnostics/policy-diagnostics";
import { getIamPolicyJsonSchema } from "@/iam/diagnostics/policy-json-schema";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { IAM_POLICY_LIMITS } from "@/iam/parser/policy-schema";
import { IAM_ACTION_CATALOG, IAM_CONDITION_OPERATORS } from "@quyan/shared";
const policy = {
  Version: "1",
  Statement: { Effect: "Allow", Action: "quyan:ram:ReadUser", Resource: "acs:quyan:*:owner:user/target" },
};
const text = (statement: Record<string, unknown>) =>
  JSON.stringify({ ...policy, Statement: { ...policy.Statement, ...statement } }, null, 2);
describe("source-aware policy diagnosis", () => {
  it("returns the parser's normalized document/hash while preserving the original source path", () => {
    const result = diagnoseIamPolicy(JSON.stringify(policy), "owner");
    expect(result).toMatchObject({ valid: true, riskLevel: "low", delegation: "not-evaluated", diagnostics: [] });
    expect(result.documentHash).toBe(parseIamPolicy(policy).documentHash);
    expect(result.document).toEqual(parseIamPolicy(policy).document);
  });
  it.each(["", "{", '{"Version":"1",}', '{/* comment */"Version":"1"}', '{"Version":"1"} trailing'])(
    "rejects malformed, JSONC and trailing data %#",
    (input) => {
      expect(diagnoseIamPolicy(input)).toMatchObject({
        valid: false,
        diagnostics: expect.arrayContaining([expect.objectContaining({ code: "json-syntax" })]),
      });
    },
  );
  it("points duplicate keys at the second key, rather than allowing last-key-wins", () => {
    const result = diagnoseIamPolicy('{\n  "Version":"1",\n  "Version":"2"\n}');
    expect(result.diagnostics[0]).toMatchObject({ code: "duplicate-key", path: "/Version", line: 3, column: 3 });
    expect(() => parseIamPolicy('{"Version":"1","Version":"1","Statement":[]}')).toThrow();
  });
  it("rejects decoded prototype keys without returning their values", () => {
    const secret = "DO_NOT_ECHO_POLICY_VALUE";
    const result = diagnoseIamPolicy('{"Statement":{"__proto__":"' + secret + '"}}');
    expect(result.diagnostics[0].code).toBe("unsafe-key");
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("reports unknown fields at their actual line and escapes JSON pointer segments", () => {
    const result = diagnoseIamPolicy(text({ "Action/typo~": "hidden-value" }));
    const diagnostic = result.diagnostics.find((d) => d.code === "unknown-field");
    expect(diagnostic?.path).toBe("/Statement/Action~1typo~0");
    expect(diagnostic?.line).toBeGreaterThan(1);
    expect(JSON.stringify(result)).not.toContain("hidden-value");
  });
  it.each([
    [{ Action: "alidns:AddDomainRecord" }, "unknown-action", "/Statement/Action"],
    [
      { Condition: { Bool: { "acs:SecureTransport": "yes" } } },
      "invalid-condition",
      "/Statement/Condition/Bool/acs:SecureTransport",
    ],
    [{ Resource: "invalid" }, "invalid-resource", "/Statement/Resource"],
    [{ Effect: "Maybe" }, "invalid-field", "/Statement/Effect"],
    [{ NotAction: "*" }, "invalid-action-selector", "/Statement/NotAction"],
  ])("reports semantic schema errors with precise pointers %#", (statement, code, pointer) => {
    const result = diagnoseIamPolicy(text(statement));
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code, path: pointer }));
    expect(result.document).toBeUndefined();
  });
  it("does not let Allow warnings imply a delegation proof", () => {
    const result = diagnoseIamPolicy(text({ Action: "*", Resource: "*" }));
    expect(result.valid).toBe(true);
    expect(result.riskLevel).toBe("high");
    expect(result.delegation).toBe("not-evaluated");
    expect(result.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(["broad-action", "broad-resource", "iam-management"]),
    );
  });
  it("checks resource account against server context while allowing an account wildcard", () => {
    expect(diagnoseIamPolicy(text({ Resource: "acs:quyan:*:other:user/id" }), "owner").valid).toBe(false);
    expect(diagnoseIamPolicy(text({ Resource: "acs:quyan:*:*:user/id" }), "owner").valid).toBe(true);
  });
  it("diagnoses resource mismatch and an unreachable Deny", () => {
    expect(diagnoseIamPolicy(text({ Resource: "acs:relay:*:owner:channel/id" })).diagnostics).toContainEqual(
      expect.objectContaining({ code: "resource-type-mismatch" }),
    );
    expect(
      diagnoseIamPolicy(text({ Effect: "Deny", Resource: "acs:relay:*:owner:channel/id" })).diagnostics,
    ).toContainEqual(expect.objectContaining({ code: "unreachable-deny" }));
  });
  it("locates duplicate normalized statements in the original unsorted array", () => {
    const result = diagnoseIamPolicy(JSON.stringify({ ...policy, Statement: [policy.Statement, policy.Statement] }));
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "duplicate-statement", path: "/Statement/1", severity: "suggestion" }),
    );
  });
  it("bounds byte size and nesting before recursively constructing the AST", () => {
    for (const input of ['"' + "中".repeat(IAM_POLICY_LIMITS.bytes) + '"', "[".repeat(5000) + "]".repeat(5000)])
      expect(diagnoseIamPolicy(input).diagnostics[0].code).toBe("document-limit");
  });
  it("caps diagnostics for adversarial source input", () => {
    const input = "{" + Array.from({ length: 120 }, () => '"Version":"1"').join(",") + "}";
    expect(diagnoseIamPolicy(input).diagnostics.length).toBe(100);
  });
});
describe("published policy JSON Schema", () => {
  it("exports strict structure, supported fields and the production catalog only", () => {
    const schema = getIamPolicyJsonSchema();
    const definitions = schema.definitions as Record<
      string,
      { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean }
    >;
    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(definitions.QuyanIdentityPolicy.additionalProperties).toBe(false);
    expect(definitions.QuyanIdentityPolicy.required).toEqual(["Version", "Statement"]);
    const serialized = JSON.stringify(schema);
    expect(serialized).toContain("Condition");
    expect(serialized).not.toContain("alidns:");
    for (const operator of IAM_CONDITION_OPERATORS) expect(serialized).toContain(operator);
    expect(schema["x-quyan-actions"]).toHaveLength(IAM_ACTION_CATALOG.length);
    expect(schema["x-quyan-server-validation-required"]).toBe(true);
  });
});

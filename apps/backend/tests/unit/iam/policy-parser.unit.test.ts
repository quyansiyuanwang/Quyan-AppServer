import { describe, expect, it } from "vitest";
import { parseIamPolicy, IamPolicyValidationError } from "../../../src/iam/parser/policy-parser";
const statement = { Effect: "Allow", Action: "alidns:AddDomainRecord", Resource: "acs:alidns:*:*:domain/qrmr.cn" };
const policy = { Version: "1", Statement: statement };
describe("IAM strict parser", () => {
  it("normalizes scalar and array forms", () => {
    expect(parseIamPolicy(policy).document.Statement[0].Action).toEqual(["alidns:AddDomainRecord"]);
    expect(parseIamPolicy(JSON.stringify(policy)).document).toEqual(
      parseIamPolicy({
        Version: "1",
        Statement: [{ ...statement, Action: [statement.Action], Resource: [statement.Resource] }],
      }).document,
    );
  });
  it("canonicalizes property order, patterns, duplicate statements and statement order", () => {
    const deny = { Effect: "Deny", Action: "alidns:Delete*", Resource: "*" };
    const a = parseIamPolicy({
      Version: "1",
      Statement: [{ ...statement, Action: ["alidns:B", "alidns:A", "alidns:B"] }, deny],
    });
    const b = parseIamPolicy({
      Statement: [deny, { Resource: statement.Resource, Effect: "Allow", Action: ["alidns:A", "alidns:B"] }, deny],
      Version: "1",
    });
    expect(a.documentHash).toBe(b.documentHash);
    expect(a.documentHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each(["Condition", "Principal", "NotAction", "NotResource", "unknown"])(
    "rejects unsupported field %s",
    (field) => {
      expect(() => parseIamPolicy({ ...policy, Statement: { ...statement, [field]: {} } })).toThrow(
        IamPolicyValidationError,
      );
    },
  );
  it.each([
    { ...policy, Version: "2012-10-17" },
    { ...policy, Extra: 1 },
    { ...policy, Statement: [] },
    { ...policy, Statement: { ...statement, Effect: "allow" } },
    { ...policy, Statement: { ...statement, Action: [] } },
    { ...policy, Statement: { ...statement, Resource: "" } },
    { ...policy, Statement: { ...statement, Action: "alidns:Describe?" } },
    { ...policy, Statement: { ...statement, Action: "bad\n:Action" } },
    { ...policy, Statement: { ...statement, Resource: "domain/bare-name" } },
  ])("rejects malformed syntax %#", (input) => expect(() => parseIamPolicy(input)).toThrow(IamPolicyValidationError));
  it("enforces size, statement and pattern limits", () => {
    expect(() => parseIamPolicy(" ".repeat(262145))).toThrow();
    expect(() => parseIamPolicy({ ...policy, Statement: Array(101).fill(statement) })).toThrow();
    expect(() => parseIamPolicy({ ...policy, Statement: { ...statement, Action: Array(501).fill("*") } })).toThrow();
    expect(() => parseIamPolicy({ ...policy, Statement: { ...statement, Action: "x".repeat(513) } })).toThrow();
  });
  it("rejects prototype keys, custom prototypes, getters, cycles and excessive depth", () => {
    expect(() => parseIamPolicy(JSON.parse('{"Version":"1","Statement":{},"__proto__":{}}'))).toThrow();
    expect(() => parseIamPolicy(Object.assign(Object.create({}), policy))).toThrow();
    const accessor = { ...policy };
    Object.defineProperty(accessor, "Statement", {
      get: () => {
        throw Error("must not execute");
      },
    });
    expect(() => parseIamPolicy(accessor)).toThrow(IamPolicyValidationError);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => parseIamPolicy(cycle)).toThrow(IamPolicyValidationError);
    let nested: unknown = {};
    for (let i = 0; i < 20; i++) nested = { nested };
    expect(() => parseIamPolicy(nested)).toThrow(IamPolicyValidationError);
  });
});

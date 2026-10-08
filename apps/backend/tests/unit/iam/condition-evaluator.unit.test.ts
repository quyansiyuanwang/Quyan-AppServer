import { describe, expect, it } from "vitest";
import type { IamCondition } from "@quyan/shared";
import { evaluateIamCondition } from "../../../src/iam/condition/condition-evaluator";
import { iamConditionSchema } from "../../../src/iam/condition/condition-schema";
import { parseIamPolicy } from "../../../src/iam/parser/policy-parser";
import { evaluatePolicies } from "../../../src/iam/evaluator/policy-evaluator";
import { requestConditionContext } from "../../../src/iam/request/condition-context";
import { matchesIpCondition } from "../../../src/iam/condition/ip-condition";
const condition = (
  operator: string,
  key: string,
  values: string | number | boolean | (string | number | boolean)[],
): IamCondition => ({ [operator]: { [key]: values } });
const strings = [
  ["StringEquals", "alice", "alice", true],
  ["StringNotEquals", "alice", "bob", true],
  ["StringEqualsIgnoreCase", "Alice", "alice", true],
  ["StringNotEqualsIgnoreCase", "Alice", "alice", false],
  ["StringLike", "agent-v1", "agent-?*", true],
  ["StringNotLike", "agent-v1", "agent-*", false],
  ["StringLike", "abc", "a.c", false],
  ["StringLike", "abc", "a?c", true],
] as const;
describe("IAM typed Condition evaluation", () => {
  it.each(strings)("%s compares strings without regex interpretation", (operator, actual, expected, result) => {
    expect(evaluateIamCondition(condition(operator, "acs:UserAgent", expected), { "acs:UserAgent": actual })).toBe(
      result,
    );
  });
  it.each([
    ["NumericEquals", 5, "5", true],
    ["NumericNotEquals", 5, 5, false],
    ["NumericLessThan", 5, 6, true],
    ["NumericLessThanEquals", 5, 5, true],
    ["NumericGreaterThan", 5, 5, false],
    ["NumericGreaterThanEquals", 5, 5, true],
  ] as const)("%s performs finite numeric comparison", (operator, actual, expected, result) => {
    expect(evaluateIamCondition(condition(operator, "quyan:EpochTime", expected), { "quyan:EpochTime": actual })).toBe(
      result,
    );
  });
  it.each([
    ["DateEquals", true],
    ["DateNotEquals", false],
    ["DateLessThan", false],
    ["DateLessThanEquals", true],
    ["DateGreaterThan", false],
    ["DateGreaterThanEquals", true],
  ] as const)("%s compares instants with timezone offsets", (operator, result) => {
    expect(
      evaluateIamCondition(condition(operator, "acs:CurrentTime", "2026-10-09T08:00:00+08:00"), {
        "acs:CurrentTime": "2026-10-09T00:00:00Z",
      }),
    ).toBe(result);
  });
  it("ANDs keys/operators, ORs values and treats absent keys explicitly with Null", () => {
    const clause = {
      StringEquals: { "quyan:PrincipalId": ["alice", "bob"], "quyan:PrincipalType": "sub_user" },
      Bool: { "acs:SecureTransport": "true" },
    };
    const context = { "quyan:PrincipalId": "bob", "quyan:PrincipalType": "sub_user", "acs:SecureTransport": true };
    expect(evaluateIamCondition(clause, context)).toBe(true);
    expect(evaluateIamCondition(clause, { ...context, "quyan:PrincipalType": "root" })).toBe(false);
    expect(evaluateIamCondition(condition("Null", "acs:SourceIp", true), {})).toBe(true);
    expect(evaluateIamCondition(condition("Null", "acs:SourceIp", false), { "acs:SourceIp": "127.0.0.1" })).toBe(true);
    expect(() => evaluateIamCondition(condition("StringNotEquals", "quyan:PrincipalId", "blocked"), {})).toThrow();
  });
  it("supports IPv4/IPv6 CIDR and makes network borders explicit", () => {
    expect(matchesIpCondition("192.0.2.1", "192.0.2.0/24", false)).toBe(true);
    expect(matchesIpCondition("192.0.2.0", "192.0.2.0/24", false)).toBe(false);
    expect(matchesIpCondition("192.0.2.255", "192.0.2.0/24", true)).toBe(true);
    expect(matchesIpCondition("192.0.2.1", "192.0.2.1", false)).toBe(true);
    expect(matchesIpCondition("2001:db8::1", "2001:db8::/32", false)).toBe(true);
    expect(matchesIpCondition("2001:db9::1", "2001:db8::/32", true)).toBe(false);
    expect(
      evaluateIamCondition(condition("NotIpAddressIncludeBorder", "acs:SourceIp", "192.0.2.0/24"), {
        "acs:SourceIp": "198.51.100.1",
      }),
    ).toBe(true);
    expect(() =>
      evaluateIamCondition(condition("NotIpAddress", "acs:SourceIp", "192.0.2.0/24"), { "acs:SourceIp": "invalid" }),
    ).toThrow();
  });
  it.each([
    {},
    { Unknown: { "quyan:PrincipalId": "x" } },
    { Bool: { "quyan:PrincipalId": true } },
    { StringEquals: { "quyan:ResourceTag/team": "x" } },
    { StringEquals: { "quyan:ResourceGroupId": "x" } },
    { NumericEquals: { "quyan:EpochTime": "" } },
    { Bool: { "acs:SecureTransport": "yes" } },
    { DateEquals: { "acs:CurrentTime": "2026-10-09" } },
    { IpAddress: { "acs:SourceIp": "127.0.0.1/33" } },
    { StringEquals: { "quyan:PrincipalId": [] } },
    { StringEquals: {} },
  ])("rejects unknown/unavailable keys, operators and malformed typed values %#", (input) => {
    expect(iamConditionSchema.safeParse(input).success).toBe(false);
  });
  it("canonicalizes condition key/value order and duplicates without changing policy hashes for unconditional documents", () => {
    const base = { Version: "1", Statement: { Effect: "Allow", Action: "quyan:ram:ReadUser", Resource: "*" } };
    const a = parseIamPolicy({
      ...base,
      Statement: {
        ...base.Statement,
        Condition: { StringEquals: { "quyan:PrincipalId": ["a", "b", "a"] }, Bool: { "acs:SecureTransport": true } },
      },
    });
    const b = parseIamPolicy({
      ...base,
      Statement: {
        ...base.Statement,
        Condition: { Bool: { "acs:SecureTransport": [true] }, StringEquals: { "quyan:PrincipalId": ["b", "a"] } },
      },
    });
    expect(a.documentHash).toBe(b.documentHash);
    expect(parseIamPolicy(base).canonicalJson).toBe(
      '{"Version":"1","Statement":[{"Effect":"Allow","Action":["quyan:ram:ReadUser"],"Resource":["*"]}]}',
    );
  });
  it("does not bypass a conditional Deny when context is missing or malformed", () => {
    const allow = parseIamPolicy({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } }).document;
    const deny = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Deny", Action: "*", Resource: "*", Condition: { Bool: { "acs:SecureTransport": false } } },
    }).document;
    const policies = [
      { policyId: "allow", document: allow },
      { policyId: "deny", document: deny },
    ];
    const request = { action: "quyan:ram:ReadUser", resource: "*" };
    expect(evaluatePolicies(policies, request)).toMatchObject({
      decision: "ImplicitDeny",
      reason: "missing-condition-context",
    });
    expect(evaluatePolicies(policies, { ...request, context: { "acs:SecureTransport": true } }).decision).toBe("Allow");
    expect(evaluatePolicies(policies, { ...request, context: { "acs:SecureTransport": false } }).decision).toBe(
      "ExplicitDeny",
    );
  });
  it("omits unavailable headers when evaluating a minimal authenticated request", () => {
    const context = requestConditionContext({ secure: false } as never, {
      subjectUserId: "child", principalUserId: "child", accountOwnerId: "owner", subjectType: "sub_user",
    });
    expect(context["acs:UserAgent"]).toBeUndefined();
    expect(context["acs:SecureTransport"]).toBe(false);
  });
  it("uses trusted authentication and Express proxy resolution, ignoring client condition maps", () => {
    const principal = {
      subjectUserId: "child",
      principalUserId: "child",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    const request = {
      headers: { "x-forwarded-for": "attacker", "user-agent": "test-agent" },
      ip: "192.0.2.1",
      secure: true,
      body: { context: { "quyan:PrincipalId": "owner", "acs:SourceIp": "attacker", "acs:SecureTransport": false } },
    } as never;
    expect(requestConditionContext(request, principal)).toMatchObject({
      "quyan:PrincipalId": "child",
      "quyan:PrincipalAccount": "owner",
      "acs:SourceIp": "192.0.2.1",
      "acs:SecureTransport": true,
    });
  });
});

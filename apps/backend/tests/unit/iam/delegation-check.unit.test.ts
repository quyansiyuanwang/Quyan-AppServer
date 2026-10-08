import { describe, expect, it } from "vitest";
import { checkIamDelegation, isProvenConditionSubset, isProvenPatternSubset } from "@/iam/delegation/delegation-check";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { IamCondition } from "@quyan/shared";
const policy = (
  Action = "quyan:ram:UpdateUser",
  Resource = "acs:quyan:*:owner:user/id",
  Effect = "Allow",
  Condition?: IamCondition,
) =>
  parseIamPolicy({ Version: "1", Statement: { Effect, Action, Resource, ...(Condition ? { Condition } : {}) } })
    .document;
describe("conservative delegation proofs", () => {
  it("permits equal grants, exact targets below wildcard grants and narrower action sets", () => {
    expect(checkIamDelegation(policy(), [policy("quyan:ram:*", "acs:quyan:*:owner:user/*")]).allowed).toBe(true);
    expect(checkIamDelegation(policy(), [policy()]).allowed).toBe(true);
  });
  it("denies self-escalation of actions or resource scope", () => {
    expect(checkIamDelegation(policy("quyan:ram:DeleteUser"), [policy()])).toMatchObject({
      allowed: false,
      issues: [{ code: "missing-allow-coverage" }],
    });
    expect(checkIamDelegation(policy("quyan:ram:UpdateUser", "acs:quyan:*:owner:user/*"), [policy()])).toMatchObject({
      allowed: false,
      issues: [{ code: "unproven-resource-subset" }],
    });
  });
  it("requires condition clauses to be preserved or strengthened", () => {
    const parent = { StringEquals: { "quyan:PrincipalId": ["one", "two"] } };
    const stricter = { StringEquals: { "quyan:PrincipalId": ["one"] }, Bool: { "acs:SecureTransport": true } };
    expect(isProvenConditionSubset(stricter, parent)).toBe(true);
    expect(isProvenConditionSubset(undefined, parent)).toBe(false);
    expect(isProvenConditionSubset({ StringEquals: { "quyan:PrincipalId": "three" } }, parent)).toBe(false);
    expect(
      checkIamDelegation(policy(undefined, undefined, undefined, stricter), [
        policy(undefined, undefined, undefined, parent),
      ]).allowed,
    ).toBe(true);
    expect(checkIamDelegation(policy(), [policy(undefined, undefined, undefined, parent)]).allowed).toBe(false);
  });
  it("cannot bypass a global or conditional Deny by delegating an Allow", () => {
    for (const deny of [
      policy(undefined, "*", "Deny"),
      policy(undefined, "*", "Deny", { Bool: { "acs:SecureTransport": false } }),
    ])
      expect(checkIamDelegation(policy(), [policy(undefined, "*"), deny])).toMatchObject({
        allowed: false,
        issues: [{ code: "explicit-deny-overlap" }],
      });
  });
  it("proves disjoint exact targets while rejecting unknown wildcard intersections", () => {
    expect(
      checkIamDelegation(policy(), [policy(undefined, "*"), policy(undefined, "acs:quyan:*:owner:user/other", "Deny")])
        .allowed,
    ).toBe(true);
    expect(
      checkIamDelegation(policy(undefined, "acs:quyan:*:owner:user/*"), [
        policy(undefined, "*"),
        policy(undefined, "acs:quyan:*:owner:user/x*", "Deny"),
      ]).allowed,
    ).toBe(false);
  });
  it("requires every resource in a multi-resource Allow to be covered", () => {
    const candidate = parseIamPolicy({
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: "quyan:ram:UpdateUser",
        Resource: ["acs:quyan:*:owner:user/id", "acs:quyan:*:owner:user/other"],
      },
    }).document;
    expect(checkIamDelegation(candidate, [policy()]).allowed).toBe(false);
  });
  it("does not treat delegated Deny as a new privilege", () => {
    expect(checkIamDelegation(policy(undefined, "*", "Deny"), []).allowed).toBe(true);
  });
  it.each([
    ["acs:quyan:*:owner:user/*", "acs:quyan:*:*:user/*", true],
    ["acs:quyan:*:owner:user/x*", "acs:quyan:*:owner:user/x*", true],
    ["acs:quyan:*:owner:user/x*", "acs:quyan:*:owner:user/*", false],
    ["acs:quyan:*:owner:user/*", "acs:quyan:*:other:user/*", false],
  ])("conservatively proves %s is a subset of %s", (child, parent, expected) =>
    expect(isProvenPatternSubset(child, parent)).toBe(expected),
  );
  it("validates stored grants before proof, rejecting malformed conditions", () => {
    expect(() =>
      checkIamDelegation(policy(), [
        { ...policy(), Statement: [{ ...policy().Statement[0], Condition: { Unknown: {} } }] },
      ]),
    ).toThrow();
  });
});

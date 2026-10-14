import { projectScopedPolicyForDelegation } from "@/iam/delegation/scoped-policy";
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

describe("scoped delegation projection", () => {
  it("never drops a relation scope when proving broad policy grants", () => {
    const document = policy("quyan:ram:UpdateUser", "*");
    const resource = "acs:quyan:*:owner:user/id";
    const projected = projectScopedPolicyForDelegation({
      policyId: "policy",
      document,
      scope: { type: "resource", arn: resource },
    })!;
    expect(projected.Statement[0].Resource).toEqual([resource]);
    expect(checkIamDelegation(policy(undefined, "acs:quyan:*:owner:user/other"), [projected]).allowed).toBe(false);
  });
  it("turns resource group membership into a finite grant and handles empty groups", () => {
    const document = policy("quyan:ram:UpdateUser", "*");
    const projected = projectScopedPolicyForDelegation({
      policyId: "policy",
      document,
      scope: { type: "resource-group", id: "group", resources: ["acs:quyan:*:owner:user/id"] },
    })!;
    expect(checkIamDelegation(policy(undefined, "acs:quyan:*:owner:user/*"), [projected]).allowed).toBe(false);
    expect(
      projectScopedPolicyForDelegation({
        policyId: "policy",
        document,
        scope: { type: "resource-group", id: "group", resources: [] },
      }),
    ).toBeUndefined();
  });
});

describe("candidate scope uses a conservative upper bound", () => {
  it("does not mistake a real unknown wildcard intersection for empty candidate authority", () => {
    const input = {
      policyId: "candidate",
      document: policy(undefined, "acs:quyan:*:owner:user/id-*"),
      scope: { type: "resource" as const, arn: "acs:quyan:*:owner:user/*-1" },
    };
    // id-1 matches both patterns, although the sufficient subset proof cannot prove either containment.
    expect(isProvenPatternSubset(input.document.Statement[0].Resource[0], input.scope.arn)).toBe(false);
    expect(projectScopedPolicyForDelegation(input)).toBeUndefined();
    const candidate = projectScopedPolicyForDelegation(input, { purpose: "candidate" })!;
    expect(candidate.Statement[0].Resource).toEqual(["acs:quyan:*:owner:user/id-*"]);
    expect(checkIamDelegation(candidate, []).allowed).toBe(false);
    expect(checkIamDelegation(candidate, [policy(undefined, "acs:quyan:*:owner:user/id-1")]).allowed).toBe(false);
  });
  it("still accepts proven exact scope and finite resource-group candidates", () => {
    const document = policy(undefined, "*");
    const scoped = projectScopedPolicyForDelegation(
      { policyId: "candidate", document, scope: { type: "resource", arn: "acs:quyan:*:owner:user/id" } },
      { purpose: "candidate" },
    )!;
    expect(checkIamDelegation(scoped, [policy()]).allowed).toBe(true);
    const empty = projectScopedPolicyForDelegation(
      { policyId: "candidate", document, scope: { type: "resource-group", id: "empty", resources: [] } },
      { purpose: "candidate" },
    );
    expect(empty).toBeUndefined();
  });
});

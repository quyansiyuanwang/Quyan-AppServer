import { describe, expect, it } from "vitest";
import type { IamPolicyDocument } from "@quyan/shared";
import { parseIamPolicy } from "../../../src/iam/parser/policy-parser";
import { evaluatePolicies, evaluatePolicyRequests } from "../../../src/iam/evaluator/policy-evaluator";
const input = (policyId: string, document: IamPolicyDocument) => ({
  policyId,
  document: parseIamPolicy(document).document,
});
const sample = input("scoped-user-policy", {
  Version: "1",
  Statement: [
    {
      Effect: "Allow",
      Action: ["quyan:ram:UpdateUser", "quyan:ram:DeleteUser"],
      Resource: ["acs:quyan:*:*:user/one", "acs:quyan:*:*:user/two"],
    },
    { Effect: "Allow", Action: "quyan:ram:ReadUser", Resource: "*" },
  ],
});
const resource = "acs:quyan:*:owner:user/one";
describe("IAM policy decisions", () => {
  it("restricts writes to selected users and allows account reads", () => {
    expect(evaluatePolicies([sample], { action: "quyan:ram:UpdateUser", resource }).decision).toBe("Allow");
    expect(
      evaluatePolicies([sample], { action: "quyan:ram:UpdateUser", resource: "acs:quyan:*:owner:user/other" }).decision,
    ).toBe("ImplicitDeny");
    expect(evaluatePolicies([sample], { action: "quyan:ram:ReadUser", resource: "*" }).decision).toBe("Allow");
  });
  it("requires both action and resource to match and denies unknown actions even under wildcard Allow", () => {
    expect(evaluatePolicies([sample], { action: "quyan:ram:CreateUser", resource }).decision).toBe("ImplicitDeny");
    expect(evaluatePolicies([], { action: "quyan:ram:UpdateUser", resource }).decision).toBe("ImplicitDeny");
    const all = input("all", { Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    expect(evaluatePolicies([all], { action: "alidns:AddDomainRecord", resource }).decision).toBe("ImplicitDeny");
  });
  it("explicit Deny wins in either policy order and retains every matching audit reference", () => {
    const deny = input("deny", {
      Version: "1",
      Statement: { Sid: "NoWrites", Effect: "Deny", Action: "quyan:ram:*", Resource: "acs:quyan:*:*:user/*" },
    });
    for (const policies of [
      [sample, deny],
      [deny, sample],
    ]) {
      const result = evaluatePolicies(policies, { action: "quyan:ram:UpdateUser", resource });
      expect(result.decision).toBe("ExplicitDeny");
      expect(result.matchedStatements).toHaveLength(2);
      expect(result.matchedStatements.map((s) => s.policyId).sort()).toEqual(["deny", "scoped-user-policy"]);
    }
  });
  it.each(["bad action", "quyan:ram:*", ""])("denies invalid request action %s", (action) => {
    expect(evaluatePolicies([sample], { action, resource }).reason).toBe("invalid-request");
  });
  it.each(["invalid", "acs:quyan:*:*:user/*", ""])("denies invalid concrete resource %s", (resource) => {
    expect(evaluatePolicies([sample], { action: "quyan:ram:UpdateUser", resource }).reason).toBe("invalid-request");
  });
  it("fails closed on malformed persisted policies", () => {
    expect(() =>
      evaluatePolicies([{ policyId: "bad", document: { Version: "2" } as never }], {
        action: "quyan:ram:UpdateUser",
        resource,
      }),
    ).toThrow();
  });
});

describe("invocation-local policy validation reuse", () => {
  it("matches individual decisions including invalid requests, scope, conditions and explicit Deny", () => {
    const scoped = { ...sample, scope: { type: "resource" as const, arn: resource } };
    const deny = input("batch-deny", {
      Version: "1",
      Statement: { Effect: "Deny", Action: "quyan:ram:DeleteUser", Resource: "*" },
    });
    const conditioned = input("batch-condition", {
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: "quyan:ram:CreateUser",
        Resource: "*",
        Condition: { Bool: { "acs:SecureTransport": true } },
      },
    });
    const policies = [scoped, deny, conditioned];
    const requests = [
      { action: "quyan:ram:UpdateUser", resource },
      { action: "quyan:ram:UpdateUser", resource: "acs:quyan:*:owner:user/other" },
      { action: "quyan:ram:DeleteUser", resource },
      { action: "quyan:ram:CreateUser", resource },
      { action: "quyan:ram:CreateUser", resource, context: { "acs:SecureTransport": true } },
      { action: "unknown:Action", resource },
    ];
    expect(evaluatePolicyRequests(policies, requests)).toEqual(
      requests.map((request) => evaluatePolicies(policies, request)),
    );
  });
  it("revalidates on every invocation and never retains a prior Allow after corruption", () => {
    const policy = input("batch-mutation", {
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:ram:UpdateUser", Resource: "*" },
    });
    const requests = [{ action: "quyan:ram:UpdateUser", resource }];
    expect(evaluatePolicyRequests([policy], requests)[0].decision).toBe("Allow");
    policy.document.Statement[0].Action = ["unknown:Action"];
    expect(() => evaluatePolicyRequests([policy], requests)).toThrow();
    expect(evaluatePolicyRequests([policy], [{ action: "unknown:Action", resource }])[0].decision).toBe("ImplicitDeny");
  });
});

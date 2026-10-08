import { describe, expect, it } from "vitest";
import type { IamPolicyDocument } from "@quyan/shared";
import { parseIamPolicy } from "../../../src/iam/parser/policy-parser";
import { evaluatePolicies } from "../../../src/iam/evaluator/policy-evaluator";
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

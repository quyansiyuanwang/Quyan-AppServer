import { describe, expect, it, vi } from "vitest";
import { getIamActionDefinition, getIamResourceType } from "@quyan/shared";
import type { IamPrincipal } from "@quyan/shared";
import { IamResourceConditionService } from "@/iam/condition/resource-condition.service";
import { IamTrustAuthorizationService } from "@/iam/trust/trust-authorization.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
const principal: IamPrincipal = {
  subjectUserId: "actor",
  principalUserId: "actor",
  accountOwnerId: "account",
  subjectType: "sub_user",
};
const resource = "acs:quyan:*:account:user/target";
const document = (Action = "quyan:ram:UpdateUser", Resource = resource) =>
  parseIamPolicy({
    Version: "1",
    Statement: {
      Effect: "Allow",
      Action,
      Resource,
      Condition: { StringEquals: { "quyan:ResourceGroupId": "team-a" } },
    },
  }).document;
const fixture = (exists = true, memberships = ["team-a"]) => {
  const groups = {
    conditionMemberships: vi.fn().mockResolvedValue(new Map([[resource, memberships]])),
    resourceExistsInAccount: vi.fn().mockResolvedValue(exists),
  };
  const articles = { findAvailableTargets: vi.fn().mockResolvedValue([]) };
  const provider = new IamResourceConditionService(articles, groups);
  const iam = new IamAuthorizationService(undefined, undefined, undefined, undefined, undefined, undefined, provider);
  return { provider, iam, groups, articles };
};
describe("trusted IAM resource group conditions", () => {
  it("enables only resource types with a registered live provider", () => {
    expect(getIamResourceType(resource)?.resourceGroupCondition).toBe(true);
    expect(getIamActionDefinition("quyan:ram:UpdateUser")?.conditionKeys).toContain("quyan:ResourceGroupId");
    expect(getIamActionDefinition("quyan:ram:AssumeRole")?.conditionKeys).toContain("quyan:ResourceGroupId");
    expect(getIamActionDefinition("quyan:article:Update")?.conditionKeys).not.toContain("quyan:ResourceGroupId");
    expect(() => document("quyan:article:Update", "*")).toThrow();
    expect(getIamResourceType("acs:quyan:*:account:account")?.resourceGroupCondition).toBeUndefined();
  });
  it("discards forged membership and reads current storage on every decision", async () => {
    const { iam, groups } = fixture(true, ["team-b"]);
    const input = {
      principal,
      action: "quyan:ram:UpdateUser",
      resources: [resource],
      policies: [{ policyId: "fixture", document: document() }],
      context: { "quyan:ResourceGroupId": "team-a" },
    };
    expect((await iam.evaluateLoadedPolicies(input))[0].decision).toBe("ImplicitDeny");
    groups.conditionMemberships.mockResolvedValue(new Map([[resource, ["team-a"]]]));
    expect((await iam.evaluateLoadedPolicies(input))[0].decision).toBe("Allow");
    expect(groups.conditionMemberships).toHaveBeenCalledTimes(2);
    expect(groups.resourceExistsInAccount).toHaveBeenCalledWith(resource, "account");
  });
  it("does not rescue unavailable targets with an unconditional Allow", async () => {
    const { iam } = fixture(false);
    const broad = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:ram:UpdateUser", Resource: "*" },
    }).document;
    expect(
      (
        await iam.evaluateLoadedPolicies({
          principal,
          action: "quyan:ram:UpdateUser",
          resources: [resource],
          policies: [
            { policyId: "conditional", document: document() },
            { policyId: "broad", document: broad },
          ],
        })
      )[0],
    ).toMatchObject({ decision: "ImplicitDeny", reason: "invalid-request" });
  });
  it("does not query membership for an unrelated Action", async () => {
    const { provider, groups, articles } = fixture();
    await provider.contexts({
      principal,
      action: "quyan:ram:ReadUser",
      resources: [resource],
      policies: [{ policyId: "fixture", document: document() }],
    });
    expect(groups.conditionMemberships).not.toHaveBeenCalled();
    expect(articles.findAvailableTargets).not.toHaveBeenCalled();
  });
  it("resolves role trust conditions through the same live provider", async () => {
    const { provider, groups } = fixture();
    const roleArn = "acs:quyan:*:account:role/role-a";
    groups.conditionMemberships.mockResolvedValue(new Map([[roleArn, ["team-a"]]]));
    const trust = new IamTrustAuthorizationService(provider);
    const policy = {
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: "quyan:ram:AssumeRole",
        Resource: roleArn,
        Principal: { RAM: "acs:quyan::account:user/actor" },
        Condition: { StringEquals: { "quyan:ResourceGroupId": "team-a" } },
      },
    };
    expect((await trust.evaluate(policy, { principal, roleArn })).decision).toBe("Allow");
    groups.conditionMemberships.mockResolvedValue(new Map());
    expect(
      (await trust.evaluate(policy, { principal, roleArn, context: { "quyan:ResourceGroupId": "team-a" } })).decision,
    ).toBe("ImplicitDeny");
  });
});

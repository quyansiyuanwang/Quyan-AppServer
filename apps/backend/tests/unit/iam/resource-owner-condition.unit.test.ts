import { describe, expect, it, vi } from "vitest";
import { getIamActionDefinition, getIamConditionKey } from "@quyan/shared";
import type { IamPrincipal, IamCondition } from "@quyan/shared";
import type { ArticleManagementTarget } from "@/store/content/article-management.repository";
import { IamResourceConditionService } from "@/iam/condition/resource-condition.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
const principal: IamPrincipal = {
  subjectUserId: "actor",
  principalUserId: "actor",
  accountOwnerId: "account",
  subjectType: "sub_user",
};
const resource = "acs:article:*:account:article/article-1";
const policy = (Condition: IamCondition = { StringEquals: { "quyan:ResourceOwnerId": "actor" } }) => ({
  policyId: "fixture",
  document: parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Allow", Action: "quyan:article:Update", Resource: resource, Condition },
  }).document,
});
const fixture = (ids = ["article-1"], authorId = "actor") => {
  const findAvailableTargets = vi
    .fn()
    .mockResolvedValue(ids.map((id) => ({ id, authorId }) as ArticleManagementTarget));
  const conditions = new IamResourceConditionService({ findAvailableTargets });
  const iam = new IamAuthorizationService(undefined, undefined, undefined, undefined, undefined, undefined, conditions);
  return { iam, findAvailableTargets };
};
describe("trusted resource-owner conditions", () => {
  it("registers ownership only on Actions with an article provider", () => {
    expect(getIamConditionKey("quyan:ResourceOwnerId")?.supported).toBe(true);
    expect(getIamActionDefinition("quyan:article:Update")?.conditionKeys).toContain("quyan:ResourceOwnerId");
    expect(getIamActionDefinition("quyan:article:ReorderArticles")?.conditionKeys).toContain("quyan:ResourceOwnerId");
    expect(getIamActionDefinition("quyan:ram:UpdateUser")?.conditionKeys).not.toContain("quyan:ResourceOwnerId");
  });
  it.each(["quyan:ram:UpdateUser", "*"])("rejects incompatible condition/Action %s", (Action) => {
    expect(() =>
      parseIamPolicy({
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action,
          Resource: "*",
          Condition: { StringEquals: { "quyan:ResourceOwnerId": "actor" } },
        },
      }),
    ).toThrow();
  });
  it("validates wildcard Actions against their concrete Catalog expansion", () => {
    expect(() =>
      parseIamPolicy({
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:article:Up*",
          Resource: "*",
          Condition: { StringEquals: { "quyan:ResourceOwnerId": "actor" } },
        },
      }),
    ).not.toThrow();
  });
  it("overwrites forged principal and resource attributes with trusted facts", async () => {
    const { iam, findAvailableTargets } = fixture();
    const [result] = await iam.evaluateLoadedPolicies({
      principal,
      action: "quyan:article:Update",
      resources: [resource],
      policies: [policy({ StringEquals: { "quyan:ResourceOwnerId": "actor", "quyan:PrincipalId": "actor" } })],
      context: { "quyan:ResourceOwnerId": "intruder", "quyan:PrincipalId": "intruder" },
    });
    expect(result.decision).toBe("Allow");
    expect(findAvailableTargets).toHaveBeenCalledWith(["article-1"], "account");
  });
  it("does not permit fabricated ownership to authorize a peer article", async () => {
    const { iam } = fixture(["article-1"], "peer");
    const [result] = await iam.evaluateLoadedPolicies({
      principal,
      action: "quyan:article:Update",
      resources: [resource],
      policies: [policy()],
      context: { "quyan:ResourceOwnerId": "actor" },
    });
    expect(result.decision).toBe("ImplicitDeny");
  });
  it("denies missing siblings without hiding valid rows or accepting an unconditional rescue", async () => {
    const { iam } = fixture();
    const broad = {
      policyId: "broad",
      document: parseIamPolicy({
        Version: "1",
        Statement: { Effect: "Allow", Action: "quyan:article:Update", Resource: "*" },
      }).document,
    };
    const results = await iam.evaluateLoadedPolicies({
      principal,
      action: "quyan:article:Update",
      resources: [resource, resource.replace("article-1", "missing")],
      policies: [policy(), broad],
    });
    expect(results.map((result) => result.decision)).toEqual(["Allow", "ImplicitDeny"]);
    expect(results[1].reason).toBe("invalid-request");
  });
  it("does not query unrelated resources and rejects account aliases", async () => {
    const { iam, findAvailableTargets } = fixture();
    const results = await iam.evaluateLoadedPolicies({
      principal,
      action: "quyan:article:Update",
      resources: ["acs:quyan:*:account:account"],
      policies: [policy()],
    });
    expect(results[0].decision).toBe("ImplicitDeny");
    expect(findAvailableTargets).not.toHaveBeenCalled();
    await expect(
      iam.evaluateLoadedPolicies({
        principal,
        action: "quyan:article:Update",
        resources: [resource.replace(":account:", ":foreign:")],
        policies: [policy()],
      }),
    ).rejects.toThrow();
  });
  it("fails closed on resource-store failures", async () => {
    const { iam, findAvailableTargets } = fixture();
    findAvailableTargets.mockRejectedValueOnce(new Error("synthetic failure"));
    await expect(
      iam.evaluateLoadedPolicies({
        principal,
        action: "quyan:article:Update",
        resources: [resource],
        policies: [policy()],
      }),
    ).rejects.toThrow();
  });
});

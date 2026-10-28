import { describe, expect, it } from "vitest";
import { Permission, iamActionsForLegacyPermission, getIamActionDefinition } from "@quyan/shared";
import { legacyPermissionsToPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { validateLegacyIamDefinitions } from "@/iam/middleware/legacy-permission-bridge";
import { planLegacyPolicy } from "@/iam/migration/legacy-policy-backfill";
const resource = "acs:article:*:owner:article/article-1",
  action = "quyan:article:ReorderArticles";
describe("native article action compatibility", () => {
  it("expands only explicitly registered legacy capability relationships", () => {
    expect(iamActionsForLegacyPermission(Permission.ARTICLE_UPDATE)).toEqual(["quyan:article:Update", action]);
    expect(iamActionsForLegacyPermission(Permission.ARTICLE_DELETE)).not.toContain(action);
    expect(getIamActionDefinition(action)).toMatchObject({
      legacyPermission: Permission.ARTICLE_UPDATE,
      resourceTypes: ["article/article"],
      sensitive: true,
    });
  });
  it("preserves legacy Allow and removal Deny on the native reorder resource", () => {
    const allow = legacyPermissionsToPolicy([Permission.ARTICLE_UPDATE], "owner")!;
    const deny = legacyPermissionsToPolicy([Permission.ARTICLE_UPDATE], "owner", "Deny")!;
    expect(evaluatePolicies([{ policyId: "allow", document: allow }], { action, resource }).decision).toBe("Allow");
    expect(
      evaluatePolicies(
        [
          { policyId: "allow", document: allow },
          { policyId: "deny", document: deny },
        ],
        { action, resource },
      ).decision,
    ).toBe("ExplicitDeny");
  });
  it("refuses aliases for unrelated permissions and proves them in backfill", () => {
    const definition = { action, resourceKind: "batch" as const, resource: () => [resource] };
    expect(() => validateLegacyIamDefinitions([Permission.ARTICLE_UPDATE], definition)).not.toThrow();
    expect(() => validateLegacyIamDefinitions([Permission.ARTICLE_DELETE], definition)).toThrow();
    expect(
      planLegacyPolicy({
        id: "fixture",
        accountOwnerId: "owner",
        type: "custom",
        permissions: [Permission.ARTICLE_UPDATE],
      }).kind,
    ).toBe("migrate");
  });
});

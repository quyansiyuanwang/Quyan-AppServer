import { describe, expect, it, vi } from "vitest";
import {
  Permission,
  actionForPermission,
  getIamActionDefinition,
  getIamResourceType,
  isIamActionResourceCompatible,
} from "@quyan/shared";
import { articleArn, isCanonicalArticleId } from "@/iam/resources/article-resources";
import { articleResourceResolver } from "@/iam/request/article-resource-resolvers";
import { ArticleManagementRepository } from "@/store/content/article-management.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { legacyPermissionsToPolicy } from "@/iam/legacy-policy";
import type { TypedRequest } from "@/types/express";
vi.mock("@/store/content/article-management.repository", () => ({
  ArticleManagementRepository: { getInstance: () => ({ findTarget: vi.fn() }) },
}));
const action = actionForPermission(Permission.ARTICLE_PUBLISH);
describe("article publication resource contract", () => {
  it("declares the existing native publication action as a sensitive concrete-article operation", () => {
    expect(action).toBe("quyan:article:Publish");
    expect(getIamActionDefinition(action)).toMatchObject({
      sensitive: true,
      accessLevel: "Write",
      authorizationStage: "declared",
      resourceTypes: ["quyan/account", "article/article"],
    });
    const resource = articleArn("owner", "article-1");
    expect(getIamResourceType(resource)?.id).toBe("article/article");
    expect(isIamActionResourceCompatible(action, resource)).toBe(true);
    expect(isIamActionResourceCompatible("quyan:developer:GetPushDelivery", resource)).toBe(false);
  });
  it.each(["", "*", "a/b", "a:b", "a?b", " article ", "..", "é", "a\n", "a".repeat(129)])(
    "rejects ambiguous or injected ID %j",
    (id) => {
      expect(isCanonicalArticleId(id)).toBe(false);
      expect(() => articleArn("owner", id)).toThrow();
    },
  );
  it("preserves account-wide legacy breadth without treating an explicit account ARN as an article wildcard", () => {
    const legacy = legacyPermissionsToPolicy([Permission.ARTICLE_PUBLISH], "owner")!;
    const resource = articleArn("owner", "article-1");
    expect(evaluatePolicies([{ policyId: "fixture-legacy", document: legacy }], { action, resource }).decision).toBe(
      "Allow",
    );
    const document = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: action, Resource: "acs:quyan:*:owner:account" },
    }).document;
    expect(evaluatePolicies([{ policyId: "fixture-publication", document }], { action, resource }).decision).toBe(
      "ImplicitDeny",
    );
  });
  it("allows only the matching article and retains global explicit Deny precedence", () => {
    const document = parseIamPolicy({
      Version: "1",
      Statement: [
        { Effect: "Allow", Action: action, Resource: articleArn("owner", "article-1") },
        { Effect: "Deny", Action: action, Resource: articleArn("owner", "article-2") },
      ],
    }).document;
    expect(
      evaluatePolicies([{ policyId: "fixture-publication", document }], {
        action,
        resource: articleArn("owner", "article-1"),
      }).decision,
    ).toBe("Allow");
    expect(
      evaluatePolicies([{ policyId: "fixture-publication", document }], {
        action,
        resource: articleArn("owner", "article-2"),
      }).decision,
    ).toBe("ExplicitDeny");
    expect(
      evaluatePolicies([{ policyId: "fixture-publication", document }], {
        action,
        resource: articleArn("owner", "article-3"),
      }).decision,
    ).toBe("ImplicitDeny");
  });
  it("rejects malformed IDs before touching the database", async () => {
    const request = { params: { id: "*" }, body: { accountId: "foreign" } } as unknown as TypedRequest;
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    const target = vi.spyOn(ArticleManagementRepository, "getInstance");
    expect(await articleResourceResolver({ request, principal })).toBeUndefined();
    expect(target).not.toHaveBeenCalled();
    target.mockRestore();
  });
});

import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, Permission, actionForPermission } from "@quyan/shared";
import { legacyPermissionsToPolicy, legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { checkIamDelegation } from "@/iam/delegation/delegation-check";
import { isGeneratedLegacyPolicyDocument } from "@/iam/migration/legacy-policy-provenance";
const owner = "account",
  actor = "actor",
  resource = "acs:article:*:account:article/article-1";
const permissions = [Permission.ARTICLE_UPDATE, Permission.ARTICLE_DELETE, Permission.ARTICLE_PUBLISH];
const projected = () => legacyPermissionsToPrincipalPolicy(permissions, owner, actor)!;
const evaluate = (action: string, authorId: string, effect: "Allow" | "Deny" = "Allow") =>
  evaluatePolicies(
    [{ policyId: "legacy", document: legacyPermissionsToPrincipalPolicy(permissions, owner, actor, effect)! }],
    { action, resource, context: { "quyan:ResourceOwnerId": authorId } },
  );
describe("subject-bound legacy article grants", () => {
  it.each(["Update", "Delete"])("keeps %s author-only without modifying persisted source data", (operation) => {
    expect(evaluate("quyan:article:" + operation, actor).decision).toBe("Allow");
    expect(evaluate("quyan:article:" + operation, "peer").decision).toBe("ImplicitDeny");
    expect(legacyPermissionsToPolicy(permissions, owner)?.Statement[0].Condition).toBeUndefined();
  });
  it.each(["Publish", "ReorderArticles"])("retains historical account-wide %s authority", (operation) => {
    expect(evaluate("quyan:article:" + operation, "peer").decision).toBe("Allow");
  });
  it("retains removals as global Deny, including native reorder aliases", () => {
    expect(evaluate("quyan:article:Update", "peer", "Deny").decision).toBe("ExplicitDeny");
    expect(evaluate("quyan:article:ReorderArticles", "peer", "Deny").decision).toBe("ExplicitDeny");
  });
  it("produces valid cross-service projections and preserves every historical account-level Permission", () => {
    const all = parseIamPolicy(legacyPermissionsToPrincipalPolicy(ALL_PERMISSIONS, owner, actor)).document;
    const mixed = parseIamPolicy(
      legacyPermissionsToPrincipalPolicy([Permission.ARTICLE_DELETE, Permission.USER_READ], owner, actor),
    ).document;
    expect(
      evaluatePolicies([{ policyId: "mixed", document: mixed }], {
        action: "quyan:article:Delete",
        resource,
        context: { "quyan:ResourceOwnerId": actor },
      }).decision,
    ).toBe("Allow");
    for (const permission of ALL_PERMISSIONS)
      expect(
        evaluatePolicies([{ policyId: "all", document: all }], {
          action: actionForPermission(permission),
          resource: "acs:quyan:*:account:account",
        }).decision,
      ).toBe("Allow");
  });
  it("does not prove unconditioned or different-author article delegation from legacy grants", () => {
    const candidate = (Condition?: object) =>
      parseIamPolicy({
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:article:Update",
          Resource: resource,
          ...(Condition ? { Condition } : {}),
        },
      }).document;
    expect(checkIamDelegation(candidate(), [projected()]).allowed).toBe(false);
    expect(
      checkIamDelegation(candidate({ StringEquals: { "quyan:ResourceOwnerId": "peer" } }), [projected()]).allowed,
    ).toBe(false);
    expect(
      checkIamDelegation(candidate({ StringEquals: { "quyan:ResourceOwnerId": actor } }), [projected()]).allowed,
    ).toBe(true);
  });
});
describe("legacy backfill provenance", () => {
  const source = [Permission.ARTICLE_UPDATE, Permission.ARTICLE_DELETE];
  const generated = () => parseIamPolicy(legacyPermissionsToPolicy(source, owner)).document;
  it("accepts current generated documents and old immutable canonical/account-only versions", () => {
    expect(isGeneratedLegacyPolicyDocument(generated(), source, owner)).toBe(true);
    const old = generated();
    old.Statement[0].Action = source.map(actionForPermission);
    old.Statement[0].Resource = ["acs:quyan:*:account:account"];
    expect(isGeneratedLegacyPolicyDocument(old, source, owner)).toBe(true);
    expect(isGeneratedLegacyPolicyDocument(old, JSON.stringify(source), owner)).toBe(true);
  });
  it.each(["extra-action", "missing-action", "wildcard-resource", "condition", "sid", "deny", "second-statement"])(
    "rejects altered generated shape: %s",
    (change) => {
      const document = generated(),
        statement = document.Statement[0];
      if (change === "extra-action") statement.Action.push("quyan:ram:DeleteUser");
      if (change === "missing-action") statement.Action = ["quyan:article:Delete"];
      if (change === "wildcard-resource") statement.Resource.push("*");
      if (change === "condition") statement.Condition = { Bool: { "acs:SecureTransport": true } };
      if (change === "sid") statement.Sid = "not-generated";
      if (change === "deny") statement.Effect = "Deny";
      if (change === "second-statement") document.Statement.push({ ...statement });
      expect(isGeneratedLegacyPolicyDocument(document, source, owner)).toBe(false);
    },
  );
  it("rejects missing, changed or invalid legacy shadow permissions and foreign resources", () => {
    for (const shadow of [
      undefined,
      [],
      [Permission.ARTICLE_UPDATE],
      [Permission.RAM_USER_CREATE],
      ["unknown:permission"],
    ])
      expect(isGeneratedLegacyPolicyDocument(generated(), shadow, owner)).toBe(false);
    expect(isGeneratedLegacyPolicyDocument(generated(), source, "foreign")).toBe(false);
  });
});

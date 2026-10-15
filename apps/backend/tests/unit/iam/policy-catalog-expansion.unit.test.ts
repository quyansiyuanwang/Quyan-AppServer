import { describe, expect, it } from "vitest";
import {
  IAM_ACTION_CATALOG,
  getIamActionDefinition,
  getIamResourcePatternTypes,
  matchIamPattern,
  ALL_PERMISSIONS,
  iamActionsForLegacyPermission,
} from "@quyan/shared";
import { iamStatementSchema, IAM_POLICY_LIMITS } from "@/iam/parser/policy-schema";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { legacyPermissionsToPrincipalPolicy, legacyPermissionsToPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
const resources = [
  "*",
  "acs:quyan:*:owner:account",
  "acs:quyan:*:owner:user/*",
  "acs:article:*:owner:article/*",
  "acs:developer:*:owner:project/*",
];
const patterns = [
  "*",
  "quyan:ram:*",
  "quyan:article:*",
  "quyan:developer:Get*",
  "quyan:ram:DeleteUser",
  "quyan:article:Publish",
];
describe("statement-local catalog expansion preserves admission semantics", () => {
  it("agrees with exhaustive wildcard matching on every action/resource pairing", () => {
    for (const pattern of patterns)
      for (const Resource of resources) {
        const expected = IAM_ACTION_CATALOG.some(
          (action) =>
            matchIamPattern(pattern, action) &&
            getIamResourcePatternTypes(Resource).some((type) =>
              getIamActionDefinition(action)!.resourceTypes.includes(type.id),
            ),
        );
        for (const Effect of ["Allow", "Deny"] as const)
          expect(iamStatementSchema.safeParse({ Effect, Action: pattern, Resource }).success).toBe(expected);
      }
  });
  it("accepts a resource when any matched action is compatible, including mixed exact/wildcard declarations", () => {
    expect(
      iamStatementSchema.safeParse({
        Effect: "Allow",
        Action: ["quyan:ram:DeleteUser", "quyan:article:*"],
        Resource: [resources[2], resources[3]],
      }).success,
    ).toBe(true);
    expect(
      iamStatementSchema.safeParse({
        Effect: "Deny",
        Action: ["quyan:ram:DeleteUser", "quyan:article:*"],
        Resource: [resources[2], resources[4]],
      }).success,
    ).toBe(false);
  });
  it("requires every matched action to support each condition key, not only one compatible action", () => {
    const Condition = { StringEquals: { "quyan:ResourceOwnerId": "actor" } };
    expect(
      iamStatementSchema.safeParse({
        Effect: "Allow",
        Action: "quyan:article:ReorderArticles",
        Resource: resources[3],
        Condition,
      }).success,
    ).toBe(true);
    expect(
      iamStatementSchema.safeParse({
        Effect: "Allow",
        Action: ["quyan:article:ReorderArticles", "quyan:ram:DeleteUser"],
        Resource: "*",
        Condition,
      }).success,
    ).toBe(false);
  });
  it("does not cache a previous admission of a caller-owned object", () => {
    const document = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:ram:DeleteUser", Resource: resources[2] },
    }).document;
    const policy = { policyId: "mutable", document },
      request = { action: "quyan:ram:DeleteUser", resource: "acs:quyan:*:owner:user/actor" };
    expect(evaluatePolicies([policy], request).decision).toBe("Allow");
    document.Statement[0].Action = ["alidns:DeleteDomainRecord"];
    expect(() => evaluatePolicies([policy], request)).toThrow();
  });
  it("continues to admit dense legacy projections without skipping any cross-service validation", () => {
    const document = legacyPermissionsToPrincipalPolicy(ALL_PERMISSIONS, "owner", "actor");
    expect(parseIamPolicy(document).document.Statement.length).toBeGreaterThan(1);
    expect(
      iamStatementSchema.safeParse({ Effect: "Allow", Action: "quyan:ram:MissingAction", Resource: "*" }).success,
    ).toBe(false);
  });
  it.each(["Allow", "Deny"] as const)("bounds dense %s compatibility documents without dropping actions", (effect) => {
    const document = parseIamPolicy(legacyPermissionsToPolicy(ALL_PERMISSIONS, "owner", effect)).document;
    expect(document.Statement.every((statement) => statement.Action.length <= IAM_POLICY_LIMITS.patterns)).toBe(true);
    expect(new Set(document.Statement.flatMap((statement) => statement.Action))).toEqual(
      new Set(ALL_PERMISSIONS.flatMap(iamActionsForLegacyPermission)),
    );
    expect(document.Statement.every((statement) => statement.Effect === effect)).toBe(true);
  });
});

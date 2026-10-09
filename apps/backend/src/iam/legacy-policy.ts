import {
  ALL_PERMISSIONS,
  Permission,
  actionForPermission,
  getIamResourcePatternTypes,
  iamActionsForLegacyPermission,
  buildAcsResource,
  getIamActionDefinition,
  IAM_RESOURCE_TYPE_CATALOG,
} from "@quyan/shared";
import type { IamEffect, NormalizedIamPolicyDocument } from "@quyan/shared";
import { IamPolicyValidationError } from "./parser/policy-parser";
const knownPermissions = new Set<string>(ALL_PERMISSIONS);
export function parseLegacyPermissions(input: unknown): Permission[] {
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      throw new IamPolicyValidationError();
    }
  }
  if (!Array.isArray(input) || input.some((item) => typeof item !== "string" || !knownPermissions.has(item)))
    throw new IamPolicyValidationError();
  return [...new Set(input)] as Permission[];
}
export function legacyPermissionsToPolicy(
  input: unknown,
  accountOwnerId: string,
  effect: IamEffect = "Allow",
): NormalizedIamPolicyDocument | undefined {
  const permissions = parseLegacyPermissions(input);
  if (!permissions.length) return undefined;
  const account = buildAcsResource({ service: "quyan", region: "*", accountId: accountOwnerId, path: "account" });
  // This is the permission-level compatibility shape. Runtime projection additionally preserves historical service guards.
  // Never reinterpret an author-supplied IAM account ARN as a resource wildcard.
  const compatibleTypes = new Set(
    permissions
      .flatMap(iamActionsForLegacyPermission)
      .flatMap((action) => getIamActionDefinition(action)!.resourceTypes),
  );
  const resources = IAM_RESOURCE_TYPE_CATALOG.filter((type) => compatibleTypes.has(type.id)).map((type) =>
    type.arnTemplate.replace("{accountId}", accountOwnerId).replace(/\{[^}]+\}/g, "*"),
  );
  return {
    Version: "1",
    Statement: [
      {
        Effect: effect,
        Action: permissions.flatMap(iamActionsForLegacyPermission),
        Resource: effect === "Deny" ? ["*"] : [...new Set([account, ...resources])],
      },
    ],
  };
}

/** Runtime compatibility preserves historical author-only edits/deletion, but not account-wide reorder. */
export function legacyPermissionsToPrincipalPolicy(
  input: unknown,
  accountOwnerId: string,
  principalUserId: string,
  effect: IamEffect = "Allow",
): NormalizedIamPolicyDocument | undefined {
  const document = legacyPermissionsToPolicy(input, accountOwnerId, effect);
  if (!document || effect === "Deny") return document;
  const authorOnly = new Set([
    actionForPermission(Permission.ARTICLE_UPDATE),
    actionForPermission(Permission.ARTICLE_DELETE),
  ]);
  const statements: NormalizedIamPolicyDocument["Statement"] = [];
  for (const statement of document.Statement) {
    const limited = statement.Action.filter((action) => authorOnly.has(action));
    const other = statement.Action.filter((action) => !authorOnly.has(action));
    if (other.length)
      statements.push({
        ...statement,
        Action: other,
        Resource: statement.Resource.filter((resource) =>
          getIamResourcePatternTypes(resource).some((type) =>
            other.some((action) => getIamActionDefinition(action)!.resourceTypes.includes(type.id)),
          ),
        ),
      });
    if (!limited.length) continue;
    const article = statement.Resource.filter((resource) =>
      getIamResourcePatternTypes(resource).some((type) => type.id === "article/article"),
    );
    const rest = statement.Resource.filter(
      (resource) =>
        !article.includes(resource) &&
        getIamResourcePatternTypes(resource).some((type) =>
          limited.some((action) => getIamActionDefinition(action)!.resourceTypes.includes(type.id)),
        ),
    );
    if (rest.length) statements.push({ ...statement, Action: limited, Resource: rest });
    if (article.length)
      statements.push({
        Sid: "LegacyArticleAuthorOnly",
        Effect: "Allow",
        Action: limited,
        Resource: article,
        Condition: { StringEquals: { "quyan:ResourceOwnerId": principalUserId } },
      });
  }
  return { Version: "1", Statement: statements };
}

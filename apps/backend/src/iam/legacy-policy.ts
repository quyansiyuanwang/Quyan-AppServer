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

/** Preserve author-only edits/deletion and author-or-published listing without restricting native explicit grants. */
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
  const nativeJsonOwnerActions = new Set([
    "quyan:json_endpoint:ListEndpoints",
    "quyan:json_endpoint:GetEndpoint",
    "quyan:json_endpoint:DeleteEndpoint",
    "quyan:json_endpoint:UpdateEndpoint",
  ]);
  const ownJsonAccess = !parseLegacyPermissions(input).includes(Permission.JSON_ENDPOINT_MANAGE);
  const statements: NormalizedIamPolicyDocument["Statement"] = [];
  for (const statement of document.Statement) {
    const ojAccess = statement.Action.filter((action) =>
      [
        "quyan:oj:ListApiKeys",
        "quyan:oj:GetApiKey",
        "quyan:oj:GetApiKeyStats",
        "quyan:oj:RevealApiKey",
        "quyan:oj:DeleteApiKey",
      ].includes(action),
    );
    if (ojAccess.length)
      statements.push({
        Effect: "Allow",
        Sid: "LegacyOjOwnKeys",
        Action: ojAccess,
        Resource: [
          IAM_RESOURCE_TYPE_CATALOG.find((type) => type.id === "oj/api-key")!
            .arnTemplate.replace("{accountId}", accountOwnerId)
            .replace("{parentId}", principalUserId)
            .replace("{resourceId}", "*"),
        ],
      });
    const limited = statement.Action.filter((action) => authorOnly.has(action));
    const list: string[] = statement.Action.filter((action) => action === "quyan:article:ListArticles");
    const jsonAccess = ownJsonAccess ? statement.Action.filter((action) => nativeJsonOwnerActions.has(action)) : [];
    if (jsonAccess.length)
      statements.push({
        Effect: "Allow",
        Sid: "LegacyJsonEndpointOwnAccess",
        Action: jsonAccess,
        Resource: [
          IAM_RESOURCE_TYPE_CATALOG.find((type) => type.id === "json-endpoint/endpoint")!
            .arnTemplate.replace("{accountId}", accountOwnerId)
            .replace("{parentId}", principalUserId)
            .replace("{resourceId}", "*"),
        ],
      });
    const jsonCreate: string[] = ownJsonAccess
      ? statement.Action.filter((action) => action === "quyan:json_endpoint:CreateEndpoint")
      : [];
    if (jsonCreate.length)
      statements.push({
        Effect: "Allow",
        Sid: "LegacyJsonEndpointOwnCreate",
        Action: jsonCreate,
        Resource: [
          buildAcsResource({
            service: "quyan",
            region: "*",
            accountId: accountOwnerId,
            path: "user/" + principalUserId,
          }),
        ],
      });
    const other = statement.Action.filter(
      (action) =>
        !authorOnly.has(action) &&
        !list.includes(action) &&
        !jsonAccess.includes(action) &&
        !jsonCreate.includes(action) &&
        !ojAccess.includes(action),
    );
    if (list.length) {
      const article = statement.Resource.filter((resource) =>
        getIamResourcePatternTypes(resource).some((type) => type.id === "article/article"),
      );
      if (article.length) {
        statements.push({
          Effect: "Allow",
          Sid: "LegacyArticleListOwn",
          Action: list,
          Resource: article,
          Condition: { StringEquals: { "quyan:ResourceOwnerId": principalUserId } },
        });
        statements.push({
          Effect: "Allow",
          Sid: "LegacyArticleListPublished",
          Action: list,
          Resource: article,
          Condition: { StringEquals: { "quyan:ArticlePublishStatus": "published" } },
        });
      }
    }
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

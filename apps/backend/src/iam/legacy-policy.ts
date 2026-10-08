import {
  ALL_PERMISSIONS,
  actionForPermission,
  buildAcsResource,
  getIamActionDefinition,
  IAM_RESOURCE_TYPE_CATALOG,
} from "@quyan/shared";
import type { IamEffect, NormalizedIamPolicyDocument, Permission } from "@quyan/shared";
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
  // Legacy permissions were account-wide. Preserve that breadth on migrated entity routes,
  // but never reinterpret an author-supplied IAM account ARN as a resource wildcard.
  const compatibleTypes = new Set(
    permissions.flatMap((permission) => getIamActionDefinition(actionForPermission(permission))!.resourceTypes),
  );
  const resources = IAM_RESOURCE_TYPE_CATALOG.filter((type) => compatibleTypes.has(type.id)).map((type) =>
    type.arnTemplate.replace("{accountId}", accountOwnerId).replace(/\{[^}]+\}/g, "*"),
  );
  return {
    Version: "1",
    Statement: [
      {
        Effect: effect,
        Action: permissions.map(actionForPermission),
        Resource: effect === "Deny" ? ["*"] : [...new Set([account, ...resources])],
      },
    ],
  };
}

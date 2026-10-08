import { ALL_PERMISSIONS, actionForPermission, buildAcsResource } from "@quyan/shared";
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
  return {
    Version: "1",
    Statement: [
      {
        Effect: effect,
        Action: permissions.map(actionForPermission),
        Resource: [
          effect === "Deny"
            ? "*"
            : buildAcsResource({ service: "quyan", region: "*", accountId: accountOwnerId, path: "account" }),
        ],
      },
    ],
  };
}

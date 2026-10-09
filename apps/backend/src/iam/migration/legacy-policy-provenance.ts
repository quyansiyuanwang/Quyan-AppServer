import { actionForPermission } from "@quyan/shared";
import type { NormalizedIamPolicyDocument } from "@quyan/shared";
import { legacyPermissionsToPolicy, parseLegacyPermissions } from "../legacy-policy";

export const IAM_BACKFILL_CREATOR = "migration:legacy-policy-backfill";
/** Hash is checked separately. Accept only the generated source shape, including older template subsets. */
export function isGeneratedLegacyPolicyDocument(
  document: NormalizedIamPolicyDocument,
  permissions: unknown,
  owner: string,
): boolean {
  try {
    const source = parseLegacyPermissions(permissions);
    const generated = legacyPermissionsToPolicy(source, owner);
    if (!generated || document.Statement.length !== 1) return false;
    const statement = document.Statement[0],
      expected = generated.Statement[0];
    if (statement.Effect !== "Allow" || statement.Sid !== undefined || statement.Condition !== undefined) return false;
    const actions = new Set(statement.Action),
      allowed = new Set(expected.Action);
    // Catalog-native aliases and new resource templates may not yet exist in an older immutable version.
    if (
      source.some((permission) => !actions.has(actionForPermission(permission))) ||
      statement.Action.some((action) => !allowed.has(action))
    )
      return false;
    const resources = new Set(expected.Resource);
    const account = expected.Resource.find((resource) => resource.endsWith(":account"))!;
    return statement.Resource.includes(account) && statement.Resource.every((resource) => resources.has(resource));
  } catch {
    return false;
  }
}

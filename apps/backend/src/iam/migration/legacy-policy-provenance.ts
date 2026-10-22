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
    if (!generated || !document.Statement.length) return false;
    // Large compatibility policies are split at the schema's per-statement pattern limit.
    // Validate the complete source vocabulary, not just the first generated chunk.
    const allowedActions = new Set(generated.Statement.flatMap((statement) => statement.Action));
    const allowedResources = new Set(generated.Statement.flatMap((statement) => statement.Resource));
    const actions = new Set(document.Statement.flatMap((statement) => statement.Action));
    const account = [...allowedResources].find((resource) => resource.endsWith(":account"));
    if (!account || source.some((permission) => !actions.has(actionForPermission(permission)))) return false;
    return (
      document.Statement.some((statement) => statement.Resource.includes(account)) &&
      document.Statement.every(
        (statement) =>
          statement.Effect === "Allow" &&
          statement.Sid === undefined &&
          statement.Condition === undefined &&
          statement.Action.every((action) => allowedActions.has(action)) &&
          statement.Resource.every((resource) => allowedResources.has(resource)),
      )
    );
  } catch {
    return false;
  }
}

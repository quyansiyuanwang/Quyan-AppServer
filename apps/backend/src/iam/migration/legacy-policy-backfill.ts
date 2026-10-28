import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import {
  ALL_PERMISSIONS,
  actionForPermission,
  buildAcsResource,
  iamActionsForLegacyPermission,
  getIamActionDefinition,
  IAM_RESOURCE_TYPE_CATALOG,
} from "@quyan/shared";
import type { ParsedIamPolicy } from "../parser/policy-parser";
import { parseIamPolicy } from "../parser/policy-parser";
import { evaluatePolicyRequests } from "../evaluator/policy-evaluator";
import { legacyPermissionsToPolicy, parseLegacyPermissions } from "../legacy-policy";

export const IAM_BACKFILL_BATCH_SIZE = 100;
export { IAM_BACKFILL_CREATOR } from "./legacy-policy-provenance";
export function legacySnapshotHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export interface LegacyPolicyCandidate {
  id: string;
  accountOwnerId: string;
  permissions: unknown;
  type: string;
}
export type LegacyPolicyPlan =
  | { kind: "migrate"; parsed: ParsedIamPolicy; sourceHash: string }
  | { kind: "skip"; reason: "empty-permissions" | "managed-policy" }
  | { kind: "invalid"; reason: "invalid-legacy-permissions" | "authorization-difference" };

/** Every old permission is compared; unknown permissions abort this policy, never disappear. */
export function planLegacyPolicy(candidate: LegacyPolicyCandidate): LegacyPolicyPlan {
  if (candidate.type !== "custom") return { kind: "skip", reason: "managed-policy" };
  try {
    const permissions = parseLegacyPermissions(candidate.permissions);
    const document = legacyPermissionsToPolicy(candidate.permissions, candidate.accountOwnerId);
    if (!document) return { kind: "skip", reason: "empty-permissions" };
    const parsed = parseIamPolicy(document);
    const resource = buildAcsResource({
      service: "quyan",
      region: "*",
      accountId: candidate.accountOwnerId,
      path: "account",
    });
    const grants = new Set(permissions);
    const grantedActions = new Set(permissions.flatMap(iamActionsForLegacyPermission));
    const checks = ALL_PERMISSIONS.map((permission) => ({
      action: actionForPermission(permission),
      resource,
      expected: grants.has(permission),
    }));
    // Validate the document once for the entire equivalence matrix, including native resource actions.
    for (const permission of ALL_PERMISSIONS)
      for (const action of iamActionsForLegacyPermission(permission).slice(1)) {
        const definition = getIamActionDefinition(action)!;
        for (const type of IAM_RESOURCE_TYPE_CATALOG.filter((type) => definition.resourceTypes.includes(type.id)))
          checks.push({
            action,
            resource: type.arnTemplate
              .replace("{accountId}", candidate.accountOwnerId)
              .replace(/\{[^}]+\}/g, "migration-fixture"),
            // Several legacy permissions may grant the same native action.
            // Compare against their union, while compatibility actions above
            // still prove that unrelated legacy permission keys stay denied.
            expected: grantedActions.has(action),
          });
      }
    const decisions = evaluatePolicyRequests([{ policyId: candidate.id, document: parsed.document }], checks);
    if (decisions.some((decision, index) => (decision.decision === "Allow") !== checks[index].expected))
      return { kind: "invalid", reason: "authorization-difference" };
    return { kind: "migrate", parsed, sourceHash: legacySnapshotHash(candidate.permissions) };
  } catch {
    return { kind: "invalid", reason: "invalid-legacy-permissions" };
  }
}

export function parseIamBackfillArgs(args: string[]) {
  const { values } = parseArgs({
    args: args[0] === "--" ? args.slice(1) : args,
    options: { apply: { type: "boolean", default: false }, "account-owner-id": { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  return { apply: values.apply, accountOwnerId: values["account-owner-id"] };
}

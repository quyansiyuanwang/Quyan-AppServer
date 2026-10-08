import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { ALL_PERMISSIONS, actionForPermission, buildAcsResource } from "@quyan/shared";
import type { ParsedIamPolicy } from "../parser/policy-parser";
import { parseIamPolicy } from "../parser/policy-parser";
import { evaluatePolicies } from "../evaluator/policy-evaluator";
import { legacyPermissionsToPolicy, parseLegacyPermissions } from "../legacy-policy";

export const IAM_BACKFILL_BATCH_SIZE = 100;
export const IAM_BACKFILL_CREATOR = "migration:legacy-policy-backfill";
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
    for (const permission of ALL_PERMISSIONS) {
      const decision = evaluatePolicies([{ policyId: candidate.id, document: parsed.document }], {
        action: actionForPermission(permission),
        resource,
      });
      if ((decision.decision === "Allow") !== grants.has(permission))
        return { kind: "invalid", reason: "authorization-difference" };
    }
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

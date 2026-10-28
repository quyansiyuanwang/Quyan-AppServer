import { createHash } from "node:crypto";
import { parseIamPolicy } from "../parser/policy-parser";
import { assertIamPolicyAccount } from "../parser/policy-account";
import { legacyPermissionsToPolicy } from "../legacy-policy";
export const IAM_AUTHORIZATION_BACKFILL_CREATOR = "migration:legacy-authorization-backfill";
export interface LegacyAuthorizationCandidate {
  id: string;
  accountOwnerId: string;
  policyId: string;
  targetType: string;
  targetId: string;
  status: number;
  updateTime: string;
  alreadyMigrated: boolean;
  principal: { accountOwnerId: string | null; status: number } | null;
  policy: {
    accountOwnerId: string;
    status: number;
    kind: string;
    format: string;
    permissions: unknown;
    version: {
      id: string;
      policyId: string;
      status: number;
      validationState: string;
      documentHash: string;
      document: unknown;
    } | null;
  } | null;
}
export type LegacyAuthorizationPlan =
  | { kind: "migrate"; sourceHash: string; documentHash: string }
  | { kind: "skip"; reason: "already-migrated" | "inactive-binding" | "inactive-principal" }
  | { kind: "invalid"; reason: "unknown-principal-type" | "missing-principal" | "cross-account" | "invalid-policy" };
export function planLegacyAuthorization(candidate: LegacyAuthorizationCandidate): LegacyAuthorizationPlan {
  if (candidate.status !== 1) return { kind: "skip", reason: "inactive-binding" };
  if (!["user", "group", "role"].includes(candidate.targetType))
    return { kind: "invalid", reason: "unknown-principal-type" };
  if (!candidate.principal) return { kind: "invalid", reason: "missing-principal" };
  if (
    candidate.principal.accountOwnerId !== candidate.accountOwnerId ||
    candidate.policy?.accountOwnerId !== candidate.accountOwnerId
  )
    return { kind: "invalid", reason: "cross-account" };
  if (candidate.principal.status !== 1) return { kind: "skip", reason: "inactive-principal" };
  const policy = candidate.policy;
  if (!policy || policy.status !== 1 || policy.kind !== "identity")
    return { kind: "invalid", reason: "invalid-policy" };
  try {
    let documentHash: string;
    if (policy.format === "iam-v1") {
      const version = policy.version;
      if (
        !version ||
        version.policyId !== candidate.policyId ||
        version.status !== 1 ||
        version.validationState !== "valid"
      )
        throw Error("Invalid policy version");
      const parsed = parseIamPolicy(version.document);
      assertIamPolicyAccount(parsed.document, candidate.accountOwnerId);
      if (parsed.documentHash !== version.documentHash) throw Error("Invalid policy hash");
      documentHash = parsed.documentHash;
    } else if (policy.format === "legacy") {
      const document = legacyPermissionsToPolicy(policy.permissions, candidate.accountOwnerId);
      documentHash = document
        ? parseIamPolicy(document).documentHash
        : createHash("sha256").update("empty-legacy-policy").digest("hex");
    } else throw Error("Unknown policy format");
    if (candidate.alreadyMigrated) return { kind: "skip", reason: "already-migrated" };
    return {
      kind: "migrate",
      sourceHash: createHash("sha256").update(JSON.stringify(candidate)).digest("hex"),
      documentHash,
    };
  } catch {
    return { kind: "invalid", reason: "invalid-policy" };
  }
}

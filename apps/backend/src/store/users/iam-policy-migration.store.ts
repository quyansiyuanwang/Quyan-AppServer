import type { LegacyPolicyCandidate } from "@/iam/migration/legacy-policy-backfill";
export interface IamPolicyMigrationStore {
  listCandidates(accountOwnerId: string | undefined, afterId?: string): Promise<LegacyPolicyCandidate[]>;
  convert(
    candidate: LegacyPolicyCandidate,
    sourceHash: string,
    documentHash: string,
  ): Promise<"migrated" | "source-changed">;
}

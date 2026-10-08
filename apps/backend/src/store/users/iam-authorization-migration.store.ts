import type { LegacyAuthorizationCandidate } from "@/iam/migration/legacy-authorization-backfill";
export interface IamAuthorizationMigrationStore {
  listCandidates(accountOwnerId?: string, afterId?: string): Promise<LegacyAuthorizationCandidate[]>;
  convert(candidate: LegacyAuthorizationCandidate, sourceHash: string): Promise<"migrated" | "source-changed">;
}

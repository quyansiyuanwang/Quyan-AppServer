import { IamAuthorizationMigrationRepository } from "@/store/users/iam-authorization-migration.repository";
import type { IamAuthorizationMigrationStore } from "@/store/users/iam-authorization-migration.store";
import { planLegacyAuthorization } from "./legacy-authorization-backfill";
export class LegacyAuthorizationBackfillService {
  constructor(
    private readonly store: IamAuthorizationMigrationStore = IamAuthorizationMigrationRepository.getInstance(),
  ) {}
  async run(
    options: {
      apply?: boolean;
      accountOwnerId?: string;
      onEvent?: (event: {
        attachmentId: string;
        policyId: string;
        accountOwnerId: string;
        outcome: string;
        reason?: string;
        documentHash?: string;
      }) => void;
    } = {},
  ) {
    if (options.apply && !options.accountOwnerId) throw Error("Apply requires an explicit account owner");
    if (options.accountOwnerId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(options.accountOwnerId))
      throw Error("Invalid account owner");
    const report = {
      mode: options.apply ? "apply" : "dry-run",
      scanned: 0,
      planned: 0,
      migrated: 0,
      skipped: 0,
      invalid: 0,
      changed: 0,
    };
    let afterId: string | undefined;
    for (;;) {
      const candidates = await this.store.listCandidates(options.accountOwnerId, afterId);
      if (!candidates.length) break;
      for (const candidate of candidates) {
        report.scanned++;
        const plan = planLegacyAuthorization(candidate);
        const event = {
          attachmentId: candidate.id,
          policyId: candidate.policyId,
          accountOwnerId: candidate.accountOwnerId,
        };
        if (plan.kind !== "migrate") {
          if (plan.kind === "invalid") report.invalid++;
          else report.skipped++;
          options.onEvent?.({ ...event, outcome: plan.kind, reason: plan.reason });
          continue;
        }
        report.planned++;
        if (!options.apply) {
          options.onEvent?.({ ...event, outcome: "planned", documentHash: plan.documentHash });
          continue;
        }
        const outcome = await this.store.convert(candidate, plan.sourceHash);
        if (outcome === "migrated") report.migrated++;
        else report.changed++;
        options.onEvent?.({ ...event, outcome, documentHash: plan.documentHash });
      }
      afterId = candidates[candidates.length - 1].id;
    }
    return report;
  }
}

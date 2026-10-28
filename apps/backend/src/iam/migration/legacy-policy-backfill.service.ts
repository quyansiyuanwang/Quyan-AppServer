import type { IamPolicyMigrationStore } from "@/store/users/iam-policy-migration.store";
import { IamPolicyMigrationRepository } from "@/store/users/iam-policy-migration.repository";
import { planLegacyPolicy } from "./legacy-policy-backfill";

export interface IamBackfillEvent {
  policyId: string;
  accountOwnerId: string;
  outcome: "planned" | "migrated" | "skipped" | "invalid" | "source-changed";
  reason?: string;
  documentHash?: string;
}
export interface IamBackfillReport {
  mode: "dry-run" | "apply";
  scanned: number;
  planned: number;
  migrated: number;
  skipped: number;
  invalid: number;
  changed: number;
}
export class LegacyPolicyBackfillService {
  private static instance: LegacyPolicyBackfillService;
  constructor(private readonly store: IamPolicyMigrationStore = IamPolicyMigrationRepository.getInstance()) {}
  static getInstance(): LegacyPolicyBackfillService {
    return (this.instance ??= new LegacyPolicyBackfillService());
  }
  async run(
    options: { apply?: boolean; accountOwnerId?: string; onEvent?: (event: IamBackfillEvent) => void } = {},
  ): Promise<IamBackfillReport> {
    if (options.apply && !options.accountOwnerId) throw new Error("Apply requires an explicit account owner");
    if (options.accountOwnerId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(options.accountOwnerId))
      throw new Error("Invalid account owner");
    const report: IamBackfillReport = {
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
        const plan = planLegacyPolicy(candidate);
        const event = { policyId: candidate.id, accountOwnerId: candidate.accountOwnerId };
        if (plan.kind === "invalid") {
          report.invalid++;
          options.onEvent?.({ ...event, outcome: "invalid", reason: plan.reason });
          continue;
        }
        if (plan.kind === "skip") {
          report.skipped++;
          options.onEvent?.({ ...event, outcome: "skipped", reason: plan.reason });
          continue;
        }
        report.planned++;
        if (!options.apply) {
          options.onEvent?.({ ...event, outcome: "planned", documentHash: plan.parsed.documentHash });
          continue;
        }
        const outcome = await this.store.convert(candidate, plan.sourceHash, plan.parsed.documentHash);
        if (outcome === "migrated") report.migrated++;
        else report.changed++;
        options.onEvent?.({ ...event, outcome, documentHash: plan.parsed.documentHash });
      }
      afterId = candidates[candidates.length - 1].id;
    }
    return report;
  }
}

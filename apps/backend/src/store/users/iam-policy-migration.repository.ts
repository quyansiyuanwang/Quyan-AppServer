import { prisma } from "@/config/database";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { IamPolicyMigrationStore } from "./iam-policy-migration.store";
import type { LegacyPolicyCandidate } from "@/iam/migration/legacy-policy-backfill";
import {
  IAM_BACKFILL_BATCH_SIZE,
  IAM_BACKFILL_CREATOR,
  planLegacyPolicy,
  legacySnapshotHash,
} from "@/iam/migration/legacy-policy-backfill";

export class IamPolicyMigrationRepository implements IamPolicyMigrationStore {
  private static instance: IamPolicyMigrationRepository;
  constructor(private readonly client: PrismaClient = prisma) {}
  static getInstance(): IamPolicyMigrationRepository {
    return (this.instance ??= new IamPolicyMigrationRepository());
  }
  listCandidates(accountOwnerId: string | undefined, afterId?: string): Promise<LegacyPolicyCandidate[]> {
    return this.client.ramPolicy.findMany({
      where: {
        accountOwnerId,
        status: 1,
        policyKind: "identity",
        documentFormat: "legacy",
        defaultVersionId: null,
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      select: { id: true, accountOwnerId: true, permissions: true, type: true },
      orderBy: { id: "asc" },
      take: IAM_BACKFILL_BATCH_SIZE,
    });
  }
  async convert(
    candidate: LegacyPolicyCandidate,
    sourceHash: string,
    documentHash: string,
  ): Promise<"migrated" | "source-changed"> {
    // Equivalence checking is CPU-heavy for a full administrator policy. Run it before
    // opening the transaction, then compare and lock the exact source snapshot inside.
    const plan = planLegacyPolicy(candidate);
    if (plan.kind !== "migrate" || plan.sourceHash !== sourceHash || plan.parsed.documentHash !== documentHash)
      return "source-changed";
    return this.client.$transaction(async (tx) => {
      const current = await tx.ramPolicy.findUnique({ where: { id: candidate.id } });
      if (
        !current ||
        current.status !== 1 ||
        current.type !== "custom" ||
        current.accountOwnerId !== candidate.accountOwnerId ||
        current.documentFormat !== "legacy" ||
        current.defaultVersionId ||
        current.policyKind !== "identity"
      )
        return "source-changed";
      if (legacySnapshotHash(current.permissions) !== sourceHash) return "source-changed";
      if (await tx.ramPolicyVersion.count({ where: { policyId: current.id } })) return "source-changed";
      // Lock the exact legacy snapshot before writing; concurrent edits/revocation cannot be overwritten.
      const locked = await tx.ramPolicy.updateMany({
        where: {
          id: current.id,
          status: 1,
          accountOwnerId: candidate.accountOwnerId,
          type: "custom",
          policyKind: "identity",
          documentFormat: "legacy",
          defaultVersionId: null,
          permissions: { equals: current.permissions as Prisma.InputJsonValue },
        },
        data: { documentFormat: "iam-v1", validationState: "valid" },
      });
      if (locked.count !== 1) return "source-changed";
      const version = await tx.ramPolicyVersion.create({
        data: {
          policyId: current.id,
          version: 1,
          document: plan.parsed.document as unknown as Prisma.InputJsonValue,
          documentHash,
          createdBy: IAM_BACKFILL_CREATOR,
        },
      });
      await tx.ramPolicy.update({ where: { id: current.id }, data: { defaultVersionId: version.id } });
      return "migrated";
    });
  }
}

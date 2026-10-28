import { prisma } from "@/config/database";
import type { Prisma, PrismaClient } from "@prisma/client";
import { IAM_BACKFILL_BATCH_SIZE } from "@/iam/migration/legacy-policy-backfill";
import {
  planLegacyAuthorization,
  IAM_AUTHORIZATION_BACKFILL_CREATOR,
} from "@/iam/migration/legacy-authorization-backfill";
import type { LegacyAuthorizationCandidate } from "@/iam/migration/legacy-authorization-backfill";
import { iamAuthorizationScopeKey } from "@/iam/authorization-scope";
import type { IamAuthorizationMigrationStore } from "./iam-authorization-migration.store";
type Client = Prisma.TransactionClient;
export class IamAuthorizationMigrationRepository implements IamAuthorizationMigrationStore {
  constructor(private readonly client: PrismaClient = prisma) {}
  private static instance: IamAuthorizationMigrationRepository;
  static getInstance() {
    return (this.instance ??= new IamAuthorizationMigrationRepository());
  }
  private async snapshot(client: Client, id: string): Promise<LegacyAuthorizationCandidate | null> {
    const binding = await client.ramPolicyAttachment.findUnique({
      where: { id },
      include: { policy: { include: { defaultVersion: true } } },
    });
    if (!binding) return null;
    let principal: LegacyAuthorizationCandidate["principal"] = null;
    if (binding.targetType === "user") {
      const user = await client.user.findUnique({
        where: { id: binding.targetId },
        select: { id: true, accountOwnerId: true, parentUserId: true, status: true },
      });
      if (user)
        principal = { accountOwnerId: user.accountOwnerId || user.parentUserId || user.id, status: user.status };
    } else if (binding.targetType === "group") {
      const group = await client.group.findUnique({
        where: { id: binding.targetId },
        select: { accountOwnerId: true, status: true },
      });
      if (group) principal = group;
    } else if (binding.targetType === "role") {
      const role = await client.ramRole.findUnique({
        where: { id: binding.targetId },
        select: { accountOwnerId: true, status: true },
      });
      if (role) principal = role;
    }
    const alreadyMigrated = Boolean(
      await client.ramAuthorization.findFirst({
        where: {
          accountOwnerId: binding.accountOwnerId,
          principalType: binding.targetType,
          principalId: binding.targetId,
          policyId: binding.policyId,
          scopeKey: iamAuthorizationScopeKey("account"),
          scopeType: "account",
          scopeArn: null,
          scopeResourceId: null,
          status: 1,
        },
      }),
    );
    const policy = binding.policy,
      version = policy.defaultVersion;
    return {
      id: binding.id,
      accountOwnerId: binding.accountOwnerId,
      policyId: binding.policyId,
      targetType: binding.targetType,
      targetId: binding.targetId,
      status: binding.status,
      updateTime: binding.updateTime.toISOString(),
      alreadyMigrated,
      principal,
      policy: {
        accountOwnerId: policy.accountOwnerId,
        status: policy.status,
        kind: policy.policyKind,
        format: policy.documentFormat,
        permissions: policy.permissions,
        version: version
          ? {
              id: version.id,
              policyId: version.policyId,
              status: version.status,
              validationState: version.validationState,
              documentHash: version.documentHash,
              document: version.document,
            }
          : null,
      },
    };
  }
  async listCandidates(accountOwnerId?: string, afterId?: string): Promise<LegacyAuthorizationCandidate[]> {
    const bindings = await this.client.ramPolicyAttachment.findMany({
      where: { accountOwnerId, status: 1, ...(afterId ? { id: { gt: afterId } } : {}) },
      select: { id: true },
      orderBy: { id: "asc" },
      take: IAM_BACKFILL_BATCH_SIZE,
    });
    const candidates: LegacyAuthorizationCandidate[] = [];
    for (const binding of bindings) {
      const candidate = await this.snapshot(this.client, binding.id);
      if (candidate) candidates.push(candidate);
    }
    return candidates;
  }
  async convert(candidate: LegacyAuthorizationCandidate, sourceHash: string): Promise<"migrated" | "source-changed"> {
    return this.client.$transaction(
      async (tx) => {
        const current = await this.snapshot(tx, candidate.id);
        if (!current) return "source-changed";
        const plan = planLegacyAuthorization(current);
        if (plan.kind !== "migrate" || plan.sourceHash !== sourceHash) return "source-changed";
        const locked = await tx.ramPolicyAttachment.updateMany({
          where: {
            id: candidate.id,
            status: 1,
            updateTime: new Date(candidate.updateTime),
            accountOwnerId: candidate.accountOwnerId,
            policyId: candidate.policyId,
            targetType: candidate.targetType,
            targetId: candidate.targetId,
          },
          data: { updateTime: new Date(Math.max(Date.now(), new Date(candidate.updateTime).getTime() + 1)) },
        });
        if (locked.count !== 1) return "source-changed";
        const scopeKey = iamAuthorizationScopeKey("account");
        await tx.ramAuthorization.upsert({
          where: {
            accountOwnerId_principalType_principalId_policyId_scopeKey: {
              accountOwnerId: current.accountOwnerId,
              principalType: current.targetType,
              principalId: current.targetId,
              policyId: current.policyId,
              scopeKey,
            },
          },
          create: {
            accountOwnerId: current.accountOwnerId,
            principalType: current.targetType,
            principalId: current.targetId,
            policyId: current.policyId,
            scopeType: "account",
            scopeKey,
            createdBy: IAM_AUTHORIZATION_BACKFILL_CREATOR,
          },
          update: {
            status: 1,
            scopeType: "account",
            scopeArn: null,
            scopeResourceId: null,
            createdBy: IAM_AUTHORIZATION_BACKFILL_CREATOR,
          },
        });
        return "migrated";
      },
      { isolationLevel: "Serializable" },
    );
  }
}

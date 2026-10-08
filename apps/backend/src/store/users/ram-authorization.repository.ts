import { lockRamResourceGroup } from "./ram-resource-group-lock";
import type { IamManagementPage } from "@/iam/management-pagination";
import { iamManagementPaginationSchema } from "@/iam/management-pagination";
import { ForbiddenError } from "@/util/errors";
import { prisma } from "@/config/database";
import { AccountStatus } from "@/util/auth/account-status";
import type {
  RamAuthorizationStore,
  CreateRamAuthorizationInput,
  IamAuthorizationTarget,
} from "./ram-authorization.store";
import type { RamAuthorization } from "@prisma/client";
export class RamAuthorizationRepository implements RamAuthorizationStore {
  private static instance: RamAuthorizationRepository;
  static getInstance() {
    return (this.instance ??= new RamAuthorizationRepository());
  }
  create(data: CreateRamAuthorizationInput): Promise<RamAuthorization> {
    return prisma.$transaction(
      async (tx) => {
        const { expectedGroupUpdateTime, expectedVersionId, expectedDocumentHash, ...record } = data;
        if (data.scopeType === "resource-group" && data.scopeResourceId)
          await lockRamResourceGroup(tx, data.scopeResourceId, expectedGroupUpdateTime);
        if (expectedVersionId !== undefined) {
          const policy = await tx.ramPolicy.findFirst({
            where: { id: data.policyId, accountOwnerId: data.accountOwnerId, status: AccountStatus.ACTIVE },
            include: { defaultVersion: true },
          });
          if (
            !policy ||
            policy.defaultVersionId !== expectedVersionId ||
            (policy.defaultVersion?.documentHash ?? null) !== expectedDocumentHash
          )
            throw new ForbiddenError("Authorization policy version changed", undefined, {
              messageKey: "iam.versionConflict",
            });
        }
        const relation = await tx.ramAuthorization.upsert({
          where: {
            accountOwnerId_principalType_principalId_policyId_scopeKey: {
              accountOwnerId: data.accountOwnerId,
              principalType: data.principalType,
              principalId: data.principalId,
              policyId: data.policyId,
              scopeKey: data.scopeKey,
            },
          },
          create: {
            ...record,
            status: AccountStatus.ACTIVE,
            scopeResourceId: data.scopeResourceId ?? null,
            scopeArn: data.scopeArn ?? null,
            description: data.description ?? null,
          },
          update: { status: AccountStatus.ACTIVE, description: data.description ?? null, createdBy: data.createdBy },
        });
        // Only account-wide authorizations can be projected into the legacy global-permission model.
        if (data.scopeType === "account")
          await tx.ramPolicyAttachment.upsert({
            where: {
              accountOwnerId_policyId_targetType_targetId: {
                accountOwnerId: data.accountOwnerId,
                policyId: data.policyId,
                targetType: data.principalType,
                targetId: data.principalId,
              },
            },
            create: {
              accountOwnerId: data.accountOwnerId,
              policyId: data.policyId,
              targetType: data.principalType,
              targetId: data.principalId,
            },
            update: { status: AccountStatus.ACTIVE },
          });
        return relation;
      },
      { isolationLevel: "Serializable" },
    );
  }
  list(
    accountOwnerId: string,
    principalType?: string,
    principalId?: string,
    page: IamManagementPage = iamManagementPaginationSchema.parse({}),
  ) {
    return prisma.ramAuthorization.findMany({
      where: {
        accountOwnerId,
        status: AccountStatus.ACTIVE,
        ...(principalType ? { principalType } : {}),
        ...(principalId ? { principalId } : {}),
      },
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
    });
  }
  listForPrincipals(accountOwnerId: string, targets: readonly IamAuthorizationTarget[]) {
    if (!targets.length) return Promise.resolve([]);
    return prisma.ramAuthorization.findMany({
      where: {
        accountOwnerId,
        status: AccountStatus.ACTIVE,
        OR: targets.map((target) => ({ ...target })),
        policy: { status: AccountStatus.ACTIVE },
      },
      include: { policy: { include: { defaultVersion: true } } },
    });
  }
  listForPolicy(policyId: string) {
    return prisma.ramAuthorization.findMany({ where: { policyId, status: AccountStatus.ACTIVE } });
  }
  listForResourceGroup(groupId: string) {
    return prisma.ramAuthorization.findMany({
      where: {
        scopeType: "resource-group",
        scopeResourceId: groupId,
        status: AccountStatus.ACTIVE,
        policy: { status: AccountStatus.ACTIVE },
      },
      include: { policy: { include: { defaultVersion: true } } },
    });
  }
  findById(id: string) {
    return prisma.ramAuthorization.findFirst({ where: { id, status: AccountStatus.ACTIVE } });
  }
  async delete(id: string) {
    await prisma.$transaction(async (tx) => {
      const current = await tx.ramAuthorization.findUnique({ where: { id } });
      if (current?.scopeType === "resource-group" && current.scopeResourceId)
        await lockRamResourceGroup(tx, current.scopeResourceId);
      const relation = await tx.ramAuthorization.update({ where: { id }, data: { status: AccountStatus.DELETED } });
      if (relation.scopeType === "account")
        await tx.ramPolicyAttachment.deleteMany({
          where: {
            accountOwnerId: relation.accountOwnerId,
            policyId: relation.policyId,
            targetType: relation.principalType,
            targetId: relation.principalId,
          },
        });
    });
  }
}

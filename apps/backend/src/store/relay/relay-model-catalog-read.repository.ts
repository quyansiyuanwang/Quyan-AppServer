import type { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isRelayModelCatalogId } from "@/iam/resources/relay-model-catalog-resources";
import { assertIamAccountPrincipal, iamAccountDenied } from "../users/iam-account-principal";
const metadata = {
  id: true,
  status: true,
  createTime: true,
  updateTime: true,
} as const satisfies Prisma.ModelPricingSelect;
export type RelayModelCatalogTarget = Prisma.ModelPricingGetPayload<{ select: typeof metadata }>;
export type RelayModelCatalogEntry = RelayModelCatalogTarget & { model: string; provider: string | null };
export class RelayModelCatalogReadRepository {
  private static instance: RelayModelCatalogReadRepository;
  static getInstance() {
    return (this.instance ??= new RelayModelCatalogReadRepository());
  }
  async snapshot(principal: IamPrincipal) {
    await assertIamAccountPrincipal(principal);
    const ids = [...new Set([principal.subjectUserId, principal.accountOwnerId])].sort();
    const users = await prisma.user.findMany({
      where: { id: { in: ids }, status: 1 },
      orderBy: { id: "asc" },
      select: { id: true, accountOwnerId: true, groupId: true, status: true, updateTime: true },
    });
    if (users.length !== ids.length || users.some((row, i) => row.id !== ids[i])) throw iamAccountDenied();
    const actor = users.find((row) => row.id === principal.subjectUserId)!;
    const group = actor.groupId
      ? await prisma.group.findUnique({
          where: { id: actor.groupId },
          select: { id: true, accountOwnerId: true, status: true, updateTime: true },
        })
      : null;
    if (
      actor.groupId &&
      (!group ||
        group.status !== 1 ||
        (group.accountOwnerId !== null && group.accountOwnerId !== principal.accountOwnerId))
    )
      throw iamAccountDenied();
    return { users, group };
  }
  async scan(after?: string) {
    if (after !== undefined && !isRelayModelCatalogId(after)) throw iamAccountDenied();
    return prisma.modelPricing.findMany({
      where: { status: 1, ...(after ? { id: { gt: after } } : {}) },
      select: metadata,
      orderBy: { id: "asc" },
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  async hydrate(targets: readonly RelayModelCatalogTarget[]): Promise<RelayModelCatalogEntry[]> {
    if (
      !targets.length ||
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      targets.some((row) => !isRelayModelCatalogId(row.id) || row.status !== 1)
    )
      throw iamAccountDenied();
    const rows = await prisma.modelPricing.findMany({
      where: { OR: targets.map((row) => ({ id: row.id, status: 1, updateTime: row.updateTime })) },
      select: { ...metadata, model: true, provider: true },
      orderBy: { id: "asc" },
    });
    if (
      rows.length !== targets.length ||
      rows.some(
        (row) =>
          !targets.some((target) => row.id === target.id && row.updateTime.getTime() === target.updateTime.getTime()),
      )
    )
      throw iamAccountDenied();
    return rows;
  }
}

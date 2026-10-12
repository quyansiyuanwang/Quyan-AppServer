import { prisma } from "@/config/database";
import type { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import { isDeveloperQuotaRecordId } from "@/iam/resources/platform-developer-quota-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { PlatformDeveloperQuotaReadStore, DeveloperQuotaReadTarget } from "./platform-developer-quota-read.store";
const metadata = {
  id: true,
  status: true,
  subjectType: true,
  subjectId: true,
  service: true,
  createTime: true,
  updateTime: true,
} as const;
export class PlatformDeveloperQuotaReadRepository implements PlatformDeveloperQuotaReadStore {
  private static instance: PlatformDeveloperQuotaReadRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new PlatformDeveloperQuotaReadRepository());
  }
  private actor(principal: IamPrincipal) {
    return platformManagementGroupSnapshot(principal, Permission.DEVELOPER_QUOTA_MANAGE);
  }
  async scan(principal: IamPrincipal, after?: string) {
    await this.actor(principal);
    if (after !== undefined && !isDeveloperQuotaRecordId(after)) throw iamAccountDenied();
    return prisma.developerQuotaOverride.findMany({
      where: { status: 1, ...(after ? { id: { gt: after } } : {}) },
      select: metadata,
      orderBy: { id: "asc" },
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  private where(targets: readonly DeveloperQuotaReadTarget[]): Prisma.DeveloperQuotaOverrideWhereInput {
    if (
      !targets.length ||
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      targets.some((t) => !isDeveloperQuotaRecordId(t.id) || t.status !== 1)
    )
      throw iamAccountDenied();
    return {
      status: 1,
      OR: targets.map((t) => ({
        id: t.id,
        subjectType: t.subjectType,
        subjectId: t.subjectId,
        service: t.service,
        updateTime: t.updateTime,
      })),
    };
  }
  async recheck(principal: IamPrincipal, targets: readonly DeveloperQuotaReadTarget[]) {
    await this.actor(principal);
    return targets.length
      ? prisma.developerQuotaOverride.findMany({ where: this.where(targets), select: metadata })
      : [];
  }
  async hydrate(principal: IamPrincipal, targets: readonly DeveloperQuotaReadTarget[]) {
    await this.actor(principal);
    return targets.length ? prisma.developerQuotaOverride.findMany({ where: this.where(targets) }) : [];
  }
}

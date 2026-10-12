import { prisma } from "@/config/database";
import type { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import { isDeveloperConfigRecordId } from "@/iam/resources/platform-developer-config-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type {
  PlatformDeveloperConfigReadStore,
  DeveloperConfigReadTarget,
} from "./platform-developer-config-read.store";
const metadata = {
  id: true,
  status: true,
  productCode: true,
  createTime: true,
  updateTime: true,
} as const;
export class PlatformDeveloperConfigReadRepository implements PlatformDeveloperConfigReadStore {
  private static instance: PlatformDeveloperConfigReadRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new PlatformDeveloperConfigReadRepository());
  }
  private actor(principal: IamPrincipal) {
    return platformManagementGroupSnapshot(principal, Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE);
  }
  async scan(principal: IamPrincipal, after?: string) {
    await this.actor(principal);
    if (after !== undefined && !isDeveloperConfigRecordId(after)) throw iamAccountDenied();
    return prisma.developerProductConfig.findMany({
      where: { status: 1, ...(after ? { id: { gt: after } } : {}) },
      select: metadata,
      orderBy: { id: "asc" },
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  private where(targets: readonly DeveloperConfigReadTarget[]): Prisma.DeveloperProductConfigWhereInput {
    if (
      !targets.length ||
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      targets.some((t) => !isDeveloperConfigRecordId(t.id) || t.status !== 1)
    )
      throw iamAccountDenied();
    return {
      status: 1,
      OR: targets.map((t) => ({
        id: t.id,
        productCode: t.productCode,
        updateTime: t.updateTime,
      })),
    };
  }
  async recheck(principal: IamPrincipal, targets: readonly DeveloperConfigReadTarget[]) {
    await this.actor(principal);
    return targets.length
      ? prisma.developerProductConfig.findMany({ where: this.where(targets), select: metadata })
      : [];
  }
  async hydrate(principal: IamPrincipal, targets: readonly DeveloperConfigReadTarget[]) {
    await this.actor(principal);
    return targets.length ? prisma.developerProductConfig.findMany({ where: this.where(targets) }) : [];
  }
}

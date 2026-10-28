import { prisma } from "@/config/database";
import type { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import { isIpWhitelistRecordId } from "@/iam/resources/platform-ip-whitelist-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { PlatformIpWhitelistReadStore, IpWhitelistReadTarget } from "./platform-ip-whitelist-read.store";
const metadata = { id: true, status: true, createTime: true, updateTime: true, expiresAt: true } as const;
export class PlatformIpWhitelistReadRepository implements PlatformIpWhitelistReadStore {
  private static instance: PlatformIpWhitelistReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformIpWhitelistReadRepository());
  }
  private actor(principal: IamPrincipal) {
    return platformManagementGroupSnapshot(principal, Permission.IP_WHITELIST_READ);
  }
  async scan(principal: IamPrincipal, after?: string) {
    await this.actor(principal);
    if (after !== undefined && !isIpWhitelistRecordId(after)) throw iamAccountDenied();
    return prisma.iPWhiteList.findMany({
      where: { status: 1, ...(after ? { id: { gt: after } } : {}) },
      select: metadata,
      orderBy: { id: "asc" },
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  async target(principal: IamPrincipal, ip: string) {
    await this.actor(principal);
    if (typeof ip !== "string" || !ip || ip.length > 45) throw iamAccountDenied();
    return prisma.iPWhiteList.findFirst({ where: { status: 1, ipAddress: ip }, select: metadata });
  }
  private where(targets: readonly IpWhitelistReadTarget[]): Prisma.IPWhiteListWhereInput {
    if (
      !targets.length ||
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      targets.some((t) => !isIpWhitelistRecordId(t.id) || t.status !== 1)
    )
      throw iamAccountDenied();
    return { status: 1, OR: targets.map((t) => ({ id: t.id, updateTime: t.updateTime })) };
  }
  async recheck(principal: IamPrincipal, targets: readonly IpWhitelistReadTarget[]) {
    await this.actor(principal);
    return targets.length ? prisma.iPWhiteList.findMany({ where: this.where(targets), select: metadata }) : [];
  }
  async hydrate(principal: IamPrincipal, targets: readonly IpWhitelistReadTarget[]) {
    await this.actor(principal);
    return targets.length ? prisma.iPWhiteList.findMany({ where: this.where(targets) }) : [];
  }
}

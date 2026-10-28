import { prisma } from "@/config/database";
import type { IPBlackList } from "@prisma/client";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { platformIpAddressIdentifier } from "@/iam/resources/platform-ip-address-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
export type PlatformIPBlacklistRecordTarget = Pick<
  IPBlackList,
  "id" | "ipAddress" | "status" | "createTime" | "updateTime"
>;
export interface PlatformIPBlacklistRecordReadStore {
  target(id: string): Promise<PlatformIPBlacklistRecordTarget | null>;
  hydrate(target: PlatformIPBlacklistRecordTarget): Promise<IPBlackList | null>;
}
export class PlatformIPBlacklistRecordReadRepository implements PlatformIPBlacklistRecordReadStore {
  private static instance: PlatformIPBlacklistRecordReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformIPBlacklistRecordReadRepository());
  }
  async target(id: string) {
    if (!isPlatformLogResourceId(id)) throw iamAccountDenied();
    return prisma.iPBlackList.findFirst({
      where: { id, status: 1 },
      select: { id: true, ipAddress: true, status: true, createTime: true, updateTime: true },
    });
  }
  async hydrate(target: PlatformIPBlacklistRecordTarget) {
    if (
      !isPlatformLogResourceId(target.id) ||
      !platformIpAddressIdentifier(target.ipAddress) ||
      target.status !== 1 ||
      !(target.createTime instanceof Date) ||
      !Number.isFinite(target.createTime.getTime()) ||
      !(target.updateTime instanceof Date) ||
      !Number.isFinite(target.updateTime.getTime())
    )
      throw iamAccountDenied();
    return prisma.iPBlackList.findFirst({
      where: {
        id: target.id,
        ipAddress: target.ipAddress,
        status: 1,
        createTime: target.createTime,
        updateTime: target.updateTime,
      },
    });
  }
}

import { prisma } from "@/config/database";
import { platformIpAddressIdentifier } from "@/iam/resources/platform-ip-address-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
export type PlatformIpAddressSnapshot = { id: string; ipAddress: string; status: number; updateTime: Date } | null;
export interface PlatformIpAddressReadStore {
  target(ip: string): Promise<PlatformIpAddressSnapshot>;
}
export class PlatformIpAddressReadRepository implements PlatformIpAddressReadStore {
  private static instance: PlatformIpAddressReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformIpAddressReadRepository());
  }
  async target(ip: string) {
    if (!platformIpAddressIdentifier(ip)) throw iamAccountDenied();
    return prisma.iPBlackList.findFirst({
      where: { ipAddress: ip, status: 1 },
      select: { id: true, ipAddress: true, status: true, updateTime: true },
    });
  }
}

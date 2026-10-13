import { prisma } from "@/config/database";
import { isApiLogResourceId } from "@/iam/resources/platform-api-log-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { PLATFORM_API_LOG_TARGET_SELECT, type PlatformApiLogReadStore } from "./platform-api-log-read.store";
export class PlatformApiLogReadRepository implements PlatformApiLogReadStore {
  private static instance: PlatformApiLogReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformApiLogReadRepository());
  }
  target(id: string) {
    if (!isApiLogResourceId(id)) throw iamAccountDenied();
    return prisma.aPILog.findFirst({ where: { id, status: 1 }, select: PLATFORM_API_LOG_TARGET_SELECT });
  }
}

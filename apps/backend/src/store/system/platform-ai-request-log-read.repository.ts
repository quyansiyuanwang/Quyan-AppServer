import { prisma } from "@/config/database";
import { isAiRequestLogResourceId } from "@/iam/resources/platform-ai-request-log-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import {
  PLATFORM_AI_LOG_TARGET_SELECT,
  type PlatformAiRequestLogReadStore,
} from "./platform-ai-request-log-read.store";
export class PlatformAiRequestLogReadRepository implements PlatformAiRequestLogReadStore {
  private static instance: PlatformAiRequestLogReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformAiRequestLogReadRepository());
  }
  target(id: string) {
    if (!isAiRequestLogResourceId(id)) throw iamAccountDenied();
    return prisma.aIRequestLog.findFirst({ where: { id, status: 1 }, select: PLATFORM_AI_LOG_TARGET_SELECT });
  }
}

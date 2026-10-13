import { prisma } from "@/config/database";
import { isErrorGroupResourceId } from "@/iam/resources/platform-error-group-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import {
  PLATFORM_ERROR_GROUP_TARGET_SELECT,
  type PlatformErrorGroupReadStore,
} from "./platform-error-group-read.store";
export class PlatformErrorGroupReadRepository implements PlatformErrorGroupReadStore {
  private static instance: PlatformErrorGroupReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformErrorGroupReadRepository());
  }
  target(id: string) {
    if (!isErrorGroupResourceId(id)) throw iamAccountDenied();
    return prisma.errorGroup.findFirst({ where: { id, status: 1 }, select: PLATFORM_ERROR_GROUP_TARGET_SELECT });
  }
}

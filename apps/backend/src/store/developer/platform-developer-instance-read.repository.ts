import { prisma } from "@/config/database";
import type { Prisma } from "@prisma/client";
import type { IamPrincipal, DeveloperProductCode } from "@quyan/shared";
import { iamAccountDenied } from "../users/iam-account-principal";
import { PlatformDeveloperUsageReadRepository } from "./platform-developer-usage-read.repository";
import { PlatformDeveloperAccountReadRepository } from "./platform-developer-account-read.repository";
import type { DeveloperAccountReadTarget } from "./platform-developer-account-read.store";
import type { DeveloperUsageLocator } from "./platform-developer-usage-read.store";
import { isDeveloperInstanceRecordId } from "@/iam/resources/platform-developer-instance-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type {
  PlatformDeveloperInstanceReadStore,
  DeveloperInstanceReadTarget,
  DeveloperInstanceCursor,
} from "./platform-developer-instance-read.store";
const metadata = {
  id: true,
  status: true,
  entitlementId: true,
  backingProjectId: true,
  createTime: true,
  updateTime: true,
  backingProject: { select: { id: true, status: true, userId: true, updateTime: true } },
} as const;
const safeDisplay = { ...metadata, name: true, slug: true, enabled: true } as const;
export class PlatformDeveloperInstanceReadRepository implements PlatformDeveloperInstanceReadStore {
  private static instance: PlatformDeveloperInstanceReadRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new PlatformDeveloperInstanceReadRepository());
  }
  target(principal: IamPrincipal, product: DeveloperProductCode, locator: DeveloperUsageLocator) {
    return PlatformDeveloperUsageReadRepository.getInstance().target(principal, product, locator);
  }
  async recheckAccount(principal: IamPrincipal, target: DeveloperAccountReadTarget) {
    const rows = await PlatformDeveloperAccountReadRepository.getInstance().recheck(principal, [target]);
    if (rows.length !== 1) throw iamAccountDenied();
  }
  async scan(principal: IamPrincipal, account: DeveloperAccountReadTarget, after?: DeveloperInstanceCursor) {
    await this.recheckAccount(principal, account);
    if (
      after &&
      (!isDeveloperInstanceRecordId(after.id) ||
        !(after.createTime instanceof Date) ||
        !Number.isFinite(after.createTime.getTime()))
    )
      throw iamAccountDenied();
    return prisma.developerProductInstance.findMany({
      where: {
        entitlementId: account.id,
        status: 1,
        backingProject: { status: 1, userId: account.accountOwnerId },
        ...(after
          ? { OR: [{ createTime: { lt: after.createTime } }, { createTime: after.createTime, id: { lt: after.id } }] }
          : {}),
      },
      select: metadata,
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  private where(
    account: DeveloperAccountReadTarget,
    targets: readonly DeveloperInstanceReadTarget[],
  ): Prisma.DeveloperProductInstanceWhereInput {
    if (
      !targets.length ||
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      targets.some((t) => !isDeveloperInstanceRecordId(t.id) || t.status !== 1 || t.entitlementId !== account.id)
    )
      throw iamAccountDenied();
    return {
      entitlementId: account.id,
      status: 1,
      OR: targets.map((t) => ({
        id: t.id,
        updateTime: t.updateTime,
        createTime: t.createTime,
        backingProjectId: t.backingProjectId,
        backingProject: {
          id: t.backingProjectId,
          status: 1,
          userId: account.accountOwnerId,
          updateTime: t.backingProject.updateTime,
        },
      })),
    };
  }
  async hydrate(
    principal: IamPrincipal,
    account: DeveloperAccountReadTarget,
    targets: readonly DeveloperInstanceReadTarget[],
  ) {
    await this.recheckAccount(principal, account);
    return targets.length
      ? prisma.developerProductInstance.findMany({ where: this.where(account, targets), select: safeDisplay })
      : [];
  }
  async recheck(
    principal: IamPrincipal,
    account: DeveloperAccountReadTarget,
    targets: readonly DeveloperInstanceReadTarget[],
  ) {
    await this.recheckAccount(principal, account);
    return targets.length
      ? prisma.developerProductInstance.findMany({ where: this.where(account, targets), select: metadata })
      : [];
  }
}

import { prisma } from "@/config/database";
import type { Prisma } from "@prisma/client";
import type { IamPrincipal, DeveloperProductCode } from "@quyan/shared";
import { iamAccountDenied } from "../users/iam-account-principal";
import { PlatformDeveloperUsageReadRepository } from "./platform-developer-usage-read.repository";
import { PlatformDeveloperAccountReadRepository } from "./platform-developer-account-read.repository";
import type { DeveloperAccountReadTarget } from "./platform-developer-account-read.store";
import type { DeveloperUsageLocator } from "./platform-developer-usage-read.store";
import { isDeveloperCallLogRecordId } from "@/iam/resources/platform-developer-call-log-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type {
  PlatformDeveloperCallLogReadStore,
  DeveloperCallLogReadTarget,
  DeveloperCallLogCursor,
} from "./platform-developer-call-log-read.store";
const metadata = { id: true, status: true, entitlementId: true, createTime: true, updateTime: true } as const;
const safeDisplay = {
  ...metadata,
  instanceId: true,
  keyId: true,
  subjectUserId: true,
  action: true,
  success: true,
  errorCode: true,
  chargeAmount: true,
} as const;
export class PlatformDeveloperCallLogReadRepository implements PlatformDeveloperCallLogReadStore {
  private static instance: PlatformDeveloperCallLogReadRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new PlatformDeveloperCallLogReadRepository());
  }
  target(principal: IamPrincipal, product: DeveloperProductCode, locator: DeveloperUsageLocator) {
    return PlatformDeveloperUsageReadRepository.getInstance().target(principal, product, locator);
  }
  async recheckAccount(principal: IamPrincipal, target: DeveloperAccountReadTarget) {
    const rows = await PlatformDeveloperAccountReadRepository.getInstance().recheck(principal, [target]);
    if (rows.length !== 1) throw iamAccountDenied();
  }
  async scan(principal: IamPrincipal, account: DeveloperAccountReadTarget, after?: DeveloperCallLogCursor) {
    await this.recheckAccount(principal, account);
    if (
      after &&
      (!isDeveloperCallLogRecordId(after.id) ||
        !(after.createTime instanceof Date) ||
        !Number.isFinite(after.createTime.getTime()))
    )
      throw iamAccountDenied();
    return prisma.developerProductCallLog.findMany({
      where: {
        entitlementId: account.id,
        status: 1,
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
    targets: readonly DeveloperCallLogReadTarget[],
  ): Prisma.DeveloperProductCallLogWhereInput {
    if (
      !targets.length ||
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      targets.some((t) => !isDeveloperCallLogRecordId(t.id) || t.status !== 1 || t.entitlementId !== account.id)
    )
      throw iamAccountDenied();
    return {
      entitlementId: account.id,
      status: 1,
      OR: targets.map((t) => ({ id: t.id, updateTime: t.updateTime, createTime: t.createTime })),
    };
  }
  async hydrate(
    principal: IamPrincipal,
    account: DeveloperAccountReadTarget,
    targets: readonly DeveloperCallLogReadTarget[],
  ) {
    await this.recheckAccount(principal, account);
    return targets.length
      ? prisma.developerProductCallLog.findMany({ where: this.where(account, targets), select: safeDisplay })
      : [];
  }
  async recheck(
    principal: IamPrincipal,
    account: DeveloperAccountReadTarget,
    targets: readonly DeveloperCallLogReadTarget[],
  ) {
    await this.recheckAccount(principal, account);
    return targets.length
      ? prisma.developerProductCallLog.findMany({ where: this.where(account, targets), select: metadata })
      : [];
  }
}

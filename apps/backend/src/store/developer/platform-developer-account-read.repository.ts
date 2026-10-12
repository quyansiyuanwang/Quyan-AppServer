import { prisma } from "@/config/database";
import type { Prisma } from "@prisma/client";
import { Permission, isDeveloperProductCode, type DeveloperProductCode, type IamPrincipal } from "@quyan/shared";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import { isDeveloperAccountRecordId } from "@/iam/resources/platform-developer-account-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type {
  PlatformDeveloperAccountReadStore,
  DeveloperAccountReadTarget,
} from "./platform-developer-account-read.store";
const ownerMetadata = { id: true, status: true, userType: true, accountOwnerId: true, updateTime: true } as const;
const metadata = {
  id: true,
  status: true,
  productCode: true,
  accountOwnerId: true,
  createTime: true,
  updateTime: true,
  accountOwner: { select: ownerMetadata },
} as const;
export class PlatformDeveloperAccountReadRepository implements PlatformDeveloperAccountReadStore {
  private static instance: PlatformDeveloperAccountReadRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new PlatformDeveloperAccountReadRepository());
  }
  private actor(principal: IamPrincipal) {
    return platformManagementGroupSnapshot(principal, Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE);
  }
  async scan(principal: IamPrincipal, after?: string, product?: DeveloperProductCode) {
    await this.actor(principal);
    if (
      (after !== undefined && !isDeveloperAccountRecordId(after)) ||
      (product !== undefined && !isDeveloperProductCode(product))
    )
      throw iamAccountDenied();
    return prisma.developerProductEntitlement.findMany({
      where: {
        status: 1,
        accountOwner: { status: 1, userType: "root" },
        ...(after ? { id: { gt: after } } : {}),
        ...(product ? { productCode: product } : {}),
      },
      select: metadata,
      orderBy: { id: "asc" },
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  private where(targets: readonly DeveloperAccountReadTarget[]): Prisma.DeveloperProductEntitlementWhereInput {
    if (
      !targets.length ||
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      targets.some(
        (t) =>
          !isDeveloperAccountRecordId(t.id) ||
          t.status !== 1 ||
          !isDeveloperAccountRecordId(t.accountOwnerId) ||
          t.accountOwner.id !== t.accountOwnerId,
      )
    )
      throw iamAccountDenied();
    return {
      status: 1,
      OR: targets.map((t) => ({
        id: t.id,
        productCode: t.productCode,
        accountOwnerId: t.accountOwnerId,
        updateTime: t.updateTime,
        accountOwner: {
          id: t.accountOwnerId,
          status: 1,
          userType: "root",
          accountOwnerId: t.accountOwner.accountOwnerId,
          updateTime: t.accountOwner.updateTime,
        },
      })),
    };
  }
  async recheck(principal: IamPrincipal, targets: readonly DeveloperAccountReadTarget[]) {
    await this.actor(principal);
    return targets.length
      ? prisma.developerProductEntitlement.findMany({ where: this.where(targets), select: metadata })
      : [];
  }
  async hydrate(principal: IamPrincipal, targets: readonly DeveloperAccountReadTarget[]) {
    await this.actor(principal);
    return targets.length
      ? prisma.developerProductEntitlement.findMany({
          where: this.where(targets),
          include: { accountOwner: { select: { ...ownerMetadata, username: true, displayName: true } } },
        })
      : [];
  }
}

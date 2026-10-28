import { prisma } from "@/config/database";
import { Permission, isDeveloperProductCode, type DeveloperProductCode, type IamPrincipal } from "@quyan/shared";
import type { Prisma } from "@prisma/client";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import { isDeveloperAccountRecordId } from "@/iam/resources/platform-developer-account-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type {
  PlatformDeveloperOwnerReadStore,
  DeveloperOwnerReadTarget,
  DeveloperOwnerCursor,
} from "./platform-developer-owner-read.store";
const ownerMetadata = {
  id: true,
  status: true,
  userType: true,
  accountOwnerId: true,
  createTime: true,
  updateTime: true,
} as const;
const accountMetadata = { id: true, status: true, productCode: true, accountOwnerId: true, updateTime: true } as const;
export class PlatformDeveloperOwnerReadRepository implements PlatformDeveloperOwnerReadStore {
  private static instance: PlatformDeveloperOwnerReadRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new PlatformDeveloperOwnerReadRepository());
  }
  private async actor(principal: IamPrincipal, product: DeveloperProductCode) {
    if (!isDeveloperProductCode(product)) throw iamAccountDenied();
    await platformManagementGroupSnapshot(principal, Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE);
  }
  async scan(principal: IamPrincipal, product: DeveloperProductCode, keyword?: string, after?: DeveloperOwnerCursor) {
    await this.actor(principal, product);
    if (
      (keyword !== undefined && (typeof keyword !== "string" || keyword.length > 200 || keyword !== keyword.trim())) ||
      (after &&
        (!isDeveloperAccountRecordId(after.id) ||
          !(after.createTime instanceof Date) ||
          !Number.isFinite(after.createTime.getTime())))
    )
      throw iamAccountDenied();
    const rows = await prisma.user.findMany({
      where: {
        status: 1,
        userType: "root",
        AND: [
          ...(keyword
            ? [
                {
                  OR: [
                    { id: { contains: keyword } },
                    { username: { contains: keyword } },
                    { displayName: { contains: keyword } },
                  ],
                },
              ]
            : []),
          ...(after
            ? [
                {
                  OR: [
                    { createTime: { lt: after.createTime } },
                    { createTime: after.createTime, id: { lt: after.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      select: {
        ...ownerMetadata,
        developerProductEntitlements: { where: { productCode: product, status: 1 }, select: accountMetadata, take: 2 },
      },
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
    return rows.map(({ developerProductEntitlements, ...row }) => {
      if (developerProductEntitlements.length > 1) throw iamAccountDenied();
      return { ...row, account: developerProductEntitlements[0] ?? null };
    });
  }
  private where(targets: readonly DeveloperOwnerReadTarget[]): Prisma.UserWhereInput {
    if (
      !targets.length ||
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      targets.some((t) => !isDeveloperAccountRecordId(t.id) || t.status !== 1 || t.userType !== "root")
    )
      throw iamAccountDenied();
    return {
      status: 1,
      userType: "root",
      OR: targets.map((t) => ({ id: t.id, updateTime: t.updateTime, accountOwnerId: t.accountOwnerId })),
    };
  }
  async recheck(principal: IamPrincipal, product: DeveloperProductCode, targets: readonly DeveloperOwnerReadTarget[]) {
    await this.actor(principal, product);
    if (!targets.length) return [];
    const rows = await prisma.user.findMany({
      where: this.where(targets),
      select: {
        ...ownerMetadata,
        developerProductEntitlements: { where: { productCode: product, status: 1 }, select: accountMetadata, take: 2 },
      },
    });
    return rows.map(({ developerProductEntitlements, ...row }) => {
      if (developerProductEntitlements.length > 1) throw iamAccountDenied();
      return { ...row, account: developerProductEntitlements[0] ?? null };
    });
  }
  async hydrate(principal: IamPrincipal, product: DeveloperProductCode, targets: readonly DeveloperOwnerReadTarget[]) {
    await this.actor(principal, product);
    if (!targets.length) return [];
    const rows = await prisma.user.findMany({
      where: this.where(targets),
      select: {
        ...ownerMetadata,
        username: true,
        displayName: true,
        developerProductEntitlements: {
          where: {
            productCode: product,
            status: 1,
            id: { in: targets.flatMap((t) => (t.account ? [t.account.id] : [])) },
            OR: targets.flatMap((t) =>
              t.account ? [{ id: t.account.id, accountOwnerId: t.id, updateTime: t.account.updateTime }] : [],
            ),
          },
          include: { accountOwner: { select: { ...ownerMetadata, username: true, displayName: true } } },
          take: 2,
        },
      },
    });
    return rows.map(({ developerProductEntitlements, ...row }) => {
      if (developerProductEntitlements.length > 1) throw iamAccountDenied();
      const accountRow = developerProductEntitlements[0] ?? null;
      const account = accountRow
        ? {
            id: accountRow.id,
            status: accountRow.status,
            productCode: accountRow.productCode,
            accountOwnerId: accountRow.accountOwnerId,
            updateTime: accountRow.updateTime,
          }
        : null;
      return { ...row, account, accountRow };
    });
  }
}

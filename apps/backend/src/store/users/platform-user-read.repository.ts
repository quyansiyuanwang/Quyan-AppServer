import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { AccountStatus } from "@/util/auth/account-status";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isPlatformUserId } from "@/iam/resources/platform-user-resources";
import { platformManagementGroupSnapshot } from "./platform-management-principal";
import { iamAccountDenied } from "./iam-account-principal";
import { buildNonDeletedUserWhere } from "./user-query";
import type { UserListFilters } from "./user.store";
import {
  PLATFORM_USER_VIEW_SELECT,
  type PlatformUserReadStore,
  type PlatformUserReadTarget,
  type PlatformUserReadWhere,
} from "./platform-user-read.store";
import type { PlatformCollectionCursor } from "../system/platform-collection.store";
// Hash only data used by the directory or its filters. Credential columns are never selected or hashed.
const revision = Prisma.sql`SHA2(CAST(JSON_ARRAY(u.id,u.status,u.createTime,u.updateTime,u.username,u.email,u.name,u.accountOwnerId,u.parentUserId,u.userType,u.groupId,u.permissionAdds,u.permissionRemoves,g.name,g.username,g.status,g.level,g.permissions,g.accountOwnerId,b.balance,b.status,b.updateTime) AS CHAR),256)`;
export function validPlatformUserTarget(row: PlatformUserReadTarget) {
  return (
    !!row &&
    isPlatformUserId(row.id) &&
    [AccountStatus.DISABLED, AccountStatus.ACTIVE].includes(row.status) &&
    typeof row.revision === "string" &&
    /^[a-f0-9]{64}$/.test(row.revision) &&
    [row.createTime, row.updateTime].every((value) => value instanceof Date && Number.isFinite(value.getTime()))
  );
}
export function samePlatformUserTargets(
  current: readonly PlatformUserReadTarget[],
  expected: readonly PlatformUserReadTarget[],
) {
  if (
    !Array.isArray(current) ||
    current.length !== expected.length ||
    new Set(current.map((row) => row.id)).size !== current.length ||
    current.some(
      (row) =>
        !validPlatformUserTarget(row) ||
        !expected.some(
          (previous) => previous.id === row.id && previous.status === row.status && previous.revision === row.revision,
        ),
    )
  )
    throw iamAccountDenied();
}
export class PlatformUserReadRepository implements PlatformUserReadStore {
  private static instance: PlatformUserReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformUserReadRepository());
  }
  private qualify(principal: IamPrincipal, tx: Prisma.TransactionClient = prisma) {
    return platformManagementGroupSnapshot(principal, Permission.USER_READ, tx);
  }
  private async level(principal: IamPrincipal, tx: Prisma.TransactionClient = prisma) {
    const group = await this.qualify(principal, tx),
      row = await tx.group.findUnique({ where: { id: group.id }, select: { level: true } });
    if (!row || !Number.isSafeInteger(row.level)) throw iamAccountDenied();
    return row.level;
  }
  async where(principal: IamPrincipal, filters: UserListFilters) {
    const level = await this.level(principal);
    return { level, query: buildNonDeletedUserWhere(filters, level) };
  }
  private validCursor(cursor: PlatformCollectionCursor) {
    if (
      !isPlatformUserId(cursor.id) ||
      !(cursor.createTime instanceof Date) ||
      !Number.isFinite(cursor.createTime.getTime())
    )
      throw iamAccountDenied();
  }
  private targets(tx: Prisma.TransactionClient, ids: readonly string[], lock = false) {
    if (!ids.length) return Promise.resolve([]);
    if (
      ids.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !isPlatformUserId(id))
    )
      throw iamAccountDenied();
    return tx.$queryRaw<PlatformUserReadTarget[]>(
      Prisma.sql`SELECT u.id,u.status,u.createTime,u.updateTime,${revision} AS revision FROM users u LEFT JOIN \`groups\` g ON g.id=u.groupId LEFT JOIN balance_accounts b ON b.userId=u.id WHERE u.status IN (${AccountStatus.DISABLED},${AccountStatus.ACTIVE}) AND u.id IN (${Prisma.join(ids)}) ORDER BY u.createTime DESC,u.id DESC ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`,
    );
  }
  async scan(
    principal: IamPrincipal,
    where: PlatformUserReadWhere,
    after?: PlatformCollectionCursor,
    boundary?: PlatformCollectionCursor,
  ) {
    if ((await this.level(principal)) !== where.level) throw iamAccountDenied();
    if (after) this.validCursor(after);
    if (boundary) this.validCursor(boundary);
    const rows = await prisma.user.findMany({
      where: {
        AND: [
          where.query,
          { status: { in: [AccountStatus.DISABLED, AccountStatus.ACTIVE] } },
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
          ...(boundary
            ? [
                {
                  OR: [
                    { createTime: { lt: boundary.createTime } },
                    { createTime: boundary.createTime, id: { lte: boundary.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      select: { id: true },
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
    const targets = await this.targets(
      prisma,
      rows.map((row) => row.id),
    );
    if (targets.length !== rows.length) throw iamAccountDenied();
    return targets;
  }
  async target(principal: IamPrincipal, id: string) {
    await this.qualify(principal);
    return (await this.targets(prisma, [id]))[0] ?? null;
  }
  async recheck(principal: IamPrincipal, expected: readonly PlatformUserReadTarget[]) {
    await this.qualify(principal);
    samePlatformUserTargets(
      await this.targets(
        prisma,
        expected.map((row) => row.id),
      ),
      expected,
    );
  }
  async hydrate(principal: IamPrincipal, expected: readonly PlatformUserReadTarget[]) {
    if (!expected.length) return [];
    return prisma.$transaction(
      async (tx) => {
        await this.qualify(principal, tx);
        samePlatformUserTargets(
          await this.targets(
            tx,
            expected.map((row) => row.id),
            true,
          ),
          expected,
        );
        const rows = await tx.user.findMany({
          where: {
            id: { in: expected.map((row) => row.id) },
            status: { in: [AccountStatus.DISABLED, AccountStatus.ACTIVE] },
          },
          select: PLATFORM_USER_VIEW_SELECT,
        });
        if (rows.length !== expected.length) throw iamAccountDenied();
        samePlatformUserTargets(
          await this.targets(
            tx,
            expected.map((row) => row.id),
          ),
          expected,
        );
        await this.qualify(principal, tx);
        return rows;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

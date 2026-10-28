import { platformSqlRowNumber } from "../system/platform-sql-row-number";
import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import type { PlatformCollectionCursor } from "../system/platform-collection.store";
import { platformScalarColumns } from "../system/platform-scalar-revision";
import {
  PLATFORM_TERMINAL_DEVICE_PUBLIC_SELECT,
  type PlatformTerminalDeviceReadStore,
  type TerminalDeviceFilters,
  type TerminalDeviceTarget,
  type TerminalDeviceProjection,
} from "./platform-terminal-device-read.store";
export function validTerminalDeviceTarget(row: TerminalDeviceTarget) {
  return (
    !!row &&
    [row.id, row.userId, row.entitlementId, row.entitlementUserId].every(isPlatformLogResourceId) &&
    row.userId === row.entitlementUserId &&
    [-1, 0, 1].includes(row.status) &&
    /^[a-f0-9]{64}$/.test(row.revision) &&
    Number.isSafeInteger(row.displayOrder) &&
    row.displayOrder > 0 &&
    [row.createTime, row.updateTime].every((date) => date instanceof Date && Number.isFinite(date.getTime()))
  );
}
export class PlatformTerminalDeviceReadRepository implements PlatformTerminalDeviceReadStore {
  private static instance: PlatformTerminalDeviceReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformTerminalDeviceReadRepository());
  }
  async where(filters: TerminalDeviceFilters) {
    if (
      (filters.status !== undefined && ![-1, 0, 1].includes(filters.status)) ||
      [filters.userId, filters.entitlementId].some((id) => id !== undefined && !isPlatformLogResourceId(id))
    )
      throw iamAccountDenied();
    return { ...filters };
  }
  private revision() {
    const columns = platformScalarColumns(
      "RemoteTerminalDeviceBinding",
      "t",
      Object.keys(PLATFORM_TERMINAL_DEVICE_PUBLIC_SELECT),
    );
    const user = platformScalarColumns("User", "u", ["id", "username", "status", "updateTime", "accountOwnerId"]);
    const entitlement = platformScalarColumns("RemoteTerminalUserEntitlement", "e", [
      "id",
      "userId",
      "name",
      "status",
      "updateTime",
    ]);
    columns.push(
      Prisma.sql`JSON_EXTRACT(t.snapshot,'$.diagnostics.availableShells')`,
      Prisma.sql`(SELECT JSON_ARRAY(${Prisma.join(user)}) FROM users u WHERE u.id=t.userId)`,
      Prisma.sql`(SELECT JSON_ARRAY(${Prisma.join(entitlement)}) FROM remote_terminal_user_entitlements e WHERE e.id=t.entitlementId)`,
    );
    return Prisma.sql`SHA2(CAST(JSON_ARRAY(${Prisma.join(columns)}) AS CHAR),256)`;
  }
  async scan(filters: TerminalDeviceFilters, after?: PlatformCollectionCursor, boundary?: PlatformCollectionCursor) {
    for (const cursor of [after, boundary])
      if (
        cursor &&
        (!isPlatformLogResourceId(cursor.id) ||
          !(cursor.createTime instanceof Date) ||
          !Number.isFinite(cursor.createTime.getTime()))
      )
        throw iamAccountDenied();
    const from = Prisma.sql`FROM remote_terminal_device_bindings t WHERE t.status ${filters.status === undefined ? Prisma.sql`>=0` : Prisma.sql`= ${filters.status}`}
      ${filters.userId ? Prisma.sql`AND BINARY t.userId=BINARY ${filters.userId}` : Prisma.empty}
      ${filters.entitlementId ? Prisma.sql`AND BINARY t.entitlementId=BINARY ${filters.entitlementId}` : Prisma.empty}`;
    const rank = platformSqlRowNumber(Prisma.sql`SELECT t.id,t.lastSeenAt,t.updateTime ${from}`, [
      { column: "lastSeenAt", current: Prisma.sql`t.lastSeenAt`, direction: "desc" },
      { column: "updateTime", current: Prisma.sql`t.updateTime`, direction: "desc" },
      { column: "id", current: Prisma.sql`t.id`, direction: "desc" },
    ]);
    const rows = await prisma.$queryRaw<
      (Omit<TerminalDeviceTarget, "displayOrder"> & { displayOrder: bigint })[]
    >(Prisma.sql`
      SELECT * FROM (
        SELECT t.id,t.userId,t.entitlementId,(SELECT e.userId FROM remote_terminal_user_entitlements e WHERE e.id=t.entitlementId) AS entitlementUserId,
          t.status,t.createTime,t.updateTime,${this.revision()} AS revision,${rank} AS displayOrder ${from}
      ) metadata WHERE 1=1
        ${after ? Prisma.sql`AND(createTime<${after.createTime} OR(createTime=${after.createTime} AND id<${after.id}))` : Prisma.empty}
        ${boundary ? Prisma.sql`AND(createTime<${boundary.createTime} OR(createTime=${boundary.createTime} AND id<=${boundary.id}))` : Prisma.empty}
      ORDER BY createTime DESC,id DESC LIMIT ${IAM_AUTHORIZATION_LIMITS.resourcesPerRequest}`);
    const result = rows.map((row) => ({ ...row, displayOrder: Number(row.displayOrder) }));
    if (result.some((row) => !validTerminalDeviceTarget(row))) throw iamAccountDenied();
    return result;
  }
  async hydrate(
    principal: IamPrincipal,
    page: readonly { target: TerminalDeviceTarget; projection: TerminalDeviceProjection }[],
  ) {
    if (
      page.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(page.map((row) => row.target.id)).size !== page.length ||
      page.some(
        (row) =>
          !validTerminalDeviceTarget(row.target) ||
          !row.projection ||
          [row.projection.username, row.projection.entitlementName].some((value) => typeof value !== "boolean"),
      )
    )
      throw iamAccountDenied();
    if (!page.length) return [];
    return prisma.$transaction(
      async (tx) => {
        await platformManagementGroupSnapshot(principal, Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ, tx);
        const ids = page.map((row) => row.target.id);
        const revisions = await tx.$queryRaw<{ id: string; revision: string; availableShells: unknown }[]>(
          Prisma.sql`SELECT t.id,${this.revision()} AS revision,JSON_EXTRACT(t.snapshot,'$.diagnostics.availableShells') AS availableShells FROM remote_terminal_device_bindings t WHERE t.id IN(${Prisma.join(ids)}) FOR UPDATE`,
        );
        if (
          revisions.length !== page.length ||
          page.some(
            (row) =>
              !revisions.some((current) => current.id === row.target.id && current.revision === row.target.revision),
          )
        )
          throw iamAccountDenied();
        const records = await tx.remoteTerminalDeviceBinding.findMany({
          where: { id: { in: ids }, status: { in: [-1, 0, 1] } },
          select: PLATFORM_TERMINAL_DEVICE_PUBLIC_SELECT,
        });
        const userIds = page.filter((row) => row.projection.username).map((row) => row.target.userId);
        const entitlementIds = page
          .filter((row) => row.projection.entitlementName)
          .map((row) => row.target.entitlementId);
        const users = userIds.length
          ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } })
          : [];
        const entitlements = entitlementIds.length
          ? await tx.remoteTerminalUserEntitlement.findMany({
              where: { id: { in: entitlementIds } },
              select: { id: true, userId: true, name: true },
            })
          : [];
        if (records.length !== page.length) throw iamAccountDenied();
        await platformManagementGroupSnapshot(principal, Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ, tx);
        return page.map(({ target, projection }) => {
          const record = records.find((row) => row.id === target.id)!,
            entitlement = entitlements.find((row) => row.id === target.entitlementId);
          if (
            !record ||
            record.userId !== target.userId ||
            record.entitlementId !== target.entitlementId ||
            (entitlement && entitlement.userId !== target.userId)
          )
            throw iamAccountDenied();
          return {
            record,
            availableShells: revisions.find((row) => row.id === target.id)!.availableShells,
            username: projection.username ? users.find((row) => row.id === target.userId)?.username : undefined,
            entitlementName: projection.entitlementName ? entitlement?.name : undefined,
          };
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

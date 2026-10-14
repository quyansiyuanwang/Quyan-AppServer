import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import type { PlatformCollectionCursor } from "../system/platform-collection.store";
import type {
  PlatformTerminalEntitlementReadStore,
  TerminalEntitlementTarget,
  TerminalEntitlementFilters,
  TerminalEntitlementProjection,
} from "./platform-terminal-entitlement-read.store";
const identifier = (name: string) => {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw iamAccountDenied();
  return Prisma.raw("`" + name + "`");
};
const model = (name: string) => {
  const result = Prisma.dmmf.datamodel.models.find((entry) => entry.name === name);
  if (!result) throw iamAccountDenied();
  return result;
};
/** Selected relation fields are exactly the public contribution, never credential/password columns. */
const fields = (name: string, alias: string, selected?: readonly string[]) => {
  const entries = model(name).fields.filter(
    (field) => field.kind !== "object" && (!selected || selected.includes(field.name)),
  );
  if (selected && entries.length !== selected.length) throw iamAccountDenied();
  return entries.map((field) => Prisma.sql`${identifier(alias)}.${identifier(field.dbName ?? field.name)}`);
};
const tokenSelect = {
  id: true,
  entitlementId: true,
  label: true,
  expiresAt: true,
  lastUsedAt: true,
  status: true,
  createTime: true,
  updateTime: true,
} as const;
export function validTerminalEntitlementTarget(row: TerminalEntitlementTarget) {
  return (
    !!row &&
    [row.id, row.userId].every(isPlatformLogResourceId) &&
    [row.templateId, row.assignedBy, row.tokenId].every((id) => id === null || isPlatformLogResourceId(id)) &&
    [-1, 0, 1].includes(row.status) &&
    /^[a-f0-9]{64}$/.test(row.revision) &&
    Number.isSafeInteger(row.displayOrder) &&
    row.displayOrder > 0 &&
    [row.createTime, row.updateTime].every((date) => date instanceof Date && Number.isFinite(date.getTime()))
  );
}
export class PlatformTerminalEntitlementReadRepository implements PlatformTerminalEntitlementReadStore {
  private static instance: PlatformTerminalEntitlementReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformTerminalEntitlementReadRepository());
  }
  async where(filters: TerminalEntitlementFilters) {
    if (
      (filters.status !== undefined && ![-1, 0, 1].includes(filters.status)) ||
      [filters.userId, filters.templateId].some((id) => id !== undefined && !isPlatformLogResourceId(id))
    )
      throw iamAccountDenied();
    return { ...filters };
  }
  private revision() {
    const columns = fields("RemoteTerminalUserEntitlement", "t");
    const user = fields("User", "u", ["id", "username", "status", "updateTime", "accountOwnerId"]);
    const template = fields("RemoteTerminalProductTemplate", "p", ["id", "name", "status", "updateTime"]);
    const token = fields("RemoteTerminalEntitlementToken", "k", Object.keys(tokenSelect));
    const device = fields("RemoteTerminalDeviceBinding", "d", [
      "id",
      "userId",
      "entitlementId",
      "status",
      "createTime",
      "updateTime",
    ]);
    columns.push(
      Prisma.sql`(SELECT JSON_ARRAY(${Prisma.join(user)}) FROM users u WHERE u.id=t.userId)`,
      Prisma.sql`(SELECT JSON_ARRAY(${Prisma.join(user)}) FROM users u WHERE u.id=t.assignedBy)`,
      Prisma.sql`(SELECT JSON_ARRAY(${Prisma.join(template)}) FROM remote_terminal_product_templates p WHERE p.id=t.templateId)`,
      Prisma.sql`(SELECT JSON_ARRAY(${Prisma.join(token)}) FROM remote_terminal_entitlement_tokens k WHERE k.entitlementId=t.id)`,
      Prisma.sql`COALESCE((SELECT CAST(JSON_ARRAYAGG(JSON_ARRAY(${Prisma.join(device)})) OVER (ORDER BY d.id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS CHAR)
        FROM remote_terminal_device_bindings d WHERE d.entitlementId=t.id AND d.status>=0 LIMIT 1), '[]')`,
    );
    return Prisma.sql`SHA2(CAST(JSON_ARRAY(${Prisma.join(columns)}) AS CHAR),256)`;
  }
  async scan(
    filters: TerminalEntitlementFilters,
    after?: PlatformCollectionCursor,
    boundary?: PlatformCollectionCursor,
  ) {
    for (const cursor of [after, boundary])
      if (
        cursor &&
        (!isPlatformLogResourceId(cursor.id) ||
          !(cursor.createTime instanceof Date) ||
          !Number.isFinite(cursor.createTime.getTime()))
      )
        throw iamAccountDenied();
    const rows = await prisma.$queryRaw<
      (Omit<TerminalEntitlementTarget, "displayOrder"> & { displayOrder: bigint })[]
    >(Prisma.sql`
      SELECT * FROM (
        SELECT t.id,t.userId,t.templateId,t.assignedBy,t.status,t.createTime,t.updateTime,
          (SELECT k.id FROM remote_terminal_entitlement_tokens k WHERE k.entitlementId=t.id) AS tokenId,
          ${this.revision()} AS revision, ROW_NUMBER() OVER (ORDER BY t.endAt ASC,t.updateTime DESC,t.id DESC) AS displayOrder
        FROM remote_terminal_user_entitlements t WHERE t.status ${filters.status === undefined ? Prisma.sql`>=0` : Prisma.sql`= ${filters.status}`}
        ${filters.userId ? Prisma.sql`AND t.userId=${filters.userId}` : Prisma.empty}
        ${filters.templateId ? Prisma.sql`AND t.templateId=${filters.templateId}` : Prisma.empty}
      ) metadata WHERE 1=1
      ${after ? Prisma.sql`AND (createTime < ${after.createTime} OR (createTime=${after.createTime} AND id<${after.id}))` : Prisma.empty}
      ${boundary ? Prisma.sql`AND (createTime < ${boundary.createTime} OR (createTime=${boundary.createTime} AND id<=${boundary.id}))` : Prisma.empty}
      ORDER BY createTime DESC,id DESC LIMIT ${IAM_AUTHORIZATION_LIMITS.resourcesPerRequest}`);
    const result = rows.map((row) => ({ ...row, displayOrder: Number(row.displayOrder) }));
    if (result.some((row) => !validTerminalEntitlementTarget(row))) throw iamAccountDenied();
    return result;
  }
  async scanDevices(target: TerminalEntitlementTarget, after?: string) {
    if (!validTerminalEntitlementTarget(target) || (after !== undefined && !isPlatformLogResourceId(after)))
      throw iamAccountDenied();
    return prisma.remoteTerminalDeviceBinding.findMany({
      where: { entitlementId: target.id, status: { gte: 0 }, ...(after ? { id: { gt: after } } : {}) },
      select: { id: true, userId: true, entitlementId: true, status: true },
      orderBy: { id: "asc" },
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  async hydrate(
    principal: IamPrincipal,
    page: readonly { target: TerminalEntitlementTarget; projection: TerminalEntitlementProjection }[],
  ) {
    if (
      page.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(page.map((row) => row.target.id)).size !== page.length ||
      page.some(
        (row) =>
          !validTerminalEntitlementTarget(row.target) ||
          !row.projection ||
          [
            row.projection.username,
            row.projection.templateName,
            row.projection.assignedByUsername,
            row.projection.tokenMetadata,
          ].some((value) => typeof value !== "boolean") ||
          (row.projection.registeredDeviceCount !== undefined &&
            (!Number.isSafeInteger(row.projection.registeredDeviceCount) || row.projection.registeredDeviceCount < 0)),
      )
    )
      throw iamAccountDenied();
    if (!page.length) return [];
    return prisma.$transaction(
      async (tx) => {
        await platformManagementGroupSnapshot(principal, Permission.REMOTE_TERMINAL_ASSIGNMENT_READ, tx);
        const ids = page.map((row) => row.target.id);
        const revisions = await tx.$queryRaw<{ id: string; revision: string }[]>(
          Prisma.sql`SELECT t.id,${this.revision()} AS revision FROM remote_terminal_user_entitlements t WHERE t.id IN (${Prisma.join(ids)}) FOR UPDATE`,
        );
        if (
          revisions.length !== page.length ||
          page.some(
            (row) =>
              !revisions.some((current) => current.id === row.target.id && current.revision === row.target.revision),
          )
        )
          throw iamAccountDenied();
        const records = await tx.remoteTerminalUserEntitlement.findMany({
          where: { id: { in: ids }, status: { in: [-1, 0, 1] } },
        });
        const userIds = [
          ...new Set(
            page.flatMap(({ target, projection }) => [
              ...(projection.username ? [target.userId] : []),
              ...(projection.assignedByUsername && target.assignedBy ? [target.assignedBy] : []),
            ]),
          ),
        ];
        const templateIds = page.flatMap(({ target, projection }) =>
          projection.templateName && target.templateId ? [target.templateId] : [],
        );
        const tokenIds = page.flatMap(({ target, projection }) =>
          projection.tokenMetadata && target.tokenId ? [target.tokenId] : [],
        );
        const users = userIds.length
          ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } })
          : [];
        const templates = templateIds.length
          ? await tx.remoteTerminalProductTemplate.findMany({
              where: { id: { in: templateIds } },
              select: { id: true, name: true },
            })
          : [];
        const tokens = tokenIds.length
          ? await tx.remoteTerminalEntitlementToken.findMany({ where: { id: { in: tokenIds } }, select: tokenSelect })
          : [];
        if (records.length !== page.length) throw iamAccountDenied();
        await platformManagementGroupSnapshot(principal, Permission.REMOTE_TERMINAL_ASSIGNMENT_READ, tx);
        return page.map(({ target, projection }) => {
          const record = records.find((row) => row.id === target.id)!,
            token = tokens.find((row) => row.id === target.tokenId);
          if (
            !record ||
            record.userId !== target.userId ||
            record.templateId !== target.templateId ||
            record.assignedBy !== target.assignedBy ||
            (token && token.entitlementId !== target.id)
          )
            throw iamAccountDenied();
          return {
            record,
            username: projection.username ? users.find((row) => row.id === target.userId)?.username : undefined,
            assignedByUsername: projection.assignedByUsername
              ? users.find((row) => row.id === target.assignedBy)?.username
              : undefined,
            templateName: projection.templateName
              ? templates.find((row) => row.id === target.templateId)?.name
              : undefined,
            registrationToken: projection.tokenMetadata ? token : undefined,
            registeredDeviceCount: projection.registeredDeviceCount,
          };
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

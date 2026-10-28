import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { iamAccountDenied } from "../users/iam-account-principal";
import { RECORD_STATUS } from "@/constant/status";
import { ConflictError } from "@/util/errors";
import { isIpWhitelistRecordId } from "@/iam/resources/platform-ip-whitelist-resources";
import { createIPWhitelistBodySchema } from "@/api/schema/system/ipwhitelist.schema";
import type {
  PlatformIpWhitelistWriteStore,
  PlatformIpWhitelistWriteGuard,
  IpWhitelistWriteTarget,
} from "./platform-ip-whitelist-write.store";
const metadata = { id: true, ipAddress: true, status: true, updateTime: true } as const;
export class PlatformIpWhitelistWriteRepository implements PlatformIpWhitelistWriteStore {
  private static instance: PlatformIpWhitelistWriteRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new PlatformIpWhitelistWriteRepository());
  }
  async target(principal: IamPrincipal, ip: string) {
    await platformManagementGroupSnapshot(principal, Permission.IP_WHITELIST_DELETE);
    return prisma.iPWhiteList.findFirst({ where: { ipAddress: ip, status: 1 }, select: metadata });
  }
  private async identity(tx: Prisma.TransactionClient, guard: PlatformIpWhitelistWriteGuard, permission: Permission) {
    if (guard.permission !== permission || guard.users.targetUserId !== guard.users.principal.subjectUserId)
      throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${guard.group.id} FOR UPDATE`);
    const current = await platformManagementGroupSnapshot(guard.users.principal, permission, tx);
    if (current.id !== guard.group.id || current.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
  }
  private async transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("IP whitelist context changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
  async create(input: { ipAddress: string; reason: string; expiresAt?: Date }, guard: PlatformIpWhitelistWriteGuard) {
    const parsed = createIPWhitelistBodySchema
      .strict()
      .safeParse({ ...input, expiresAt: input.expiresAt?.toISOString() });
    if (!parsed.success) throw iamAccountDenied();
    return this.transaction(async (tx) => {
      await this.identity(tx, guard, Permission.IP_WHITELIST_CREATE);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ip_white_lists WHERE ipAddress = ${input.ipAddress} FOR UPDATE`);
      const existing = await tx.iPWhiteList.findUnique({ where: { ipAddress: input.ipAddress } });
      if (existing && existing.status !== RECORD_STATUS.DELETED)
        throw new ConflictError("IP whitelist entry already exists", undefined, { messageKey: "errors.conflict" });
      // Restoring a record keeps its identity and therefore all existing resource-scoped Deny statements.
      if (existing) await guard.recheckEntry(existing.id);
      const data = {
        ipAddress: input.ipAddress,
        reason: input.reason,
        addedBy: guard.users.principal.subjectUserId,
        expiresAt: input.expiresAt ?? null,
        status: 1,
      };
      const row = existing
        ? await tx.iPWhiteList.update({ where: { id: existing.id }, data })
        : await tx.iPWhiteList.create({ data });
      await guard.recheckEntry(row.id);
      await this.identity(tx, guard, Permission.IP_WHITELIST_CREATE);
      return row;
    });
  }
  async remove(target: IpWhitelistWriteTarget, guard: PlatformIpWhitelistWriteGuard) {
    if (!isIpWhitelistRecordId(target.id) || target.status !== 1 || !(target.updateTime instanceof Date))
      throw iamAccountDenied();
    return this.transaction(async (tx) => {
      await this.identity(tx, guard, Permission.IP_WHITELIST_DELETE);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ip_white_lists WHERE id = ${target.id} FOR UPDATE`);
      const row = await tx.iPWhiteList.findUnique({ where: { id: target.id }, select: metadata });
      if (
        !row ||
        row.status !== 1 ||
        row.ipAddress !== target.ipAddress ||
        row.updateTime.getTime() !== target.updateTime.getTime()
      )
        throw iamAccountDenied();
      await guard.recheckEntry(row.id);
      await tx.iPWhiteList.update({ where: { id: row.id }, data: { status: RECORD_STATUS.DELETED } });
      await this.identity(tx, guard, Permission.IP_WHITELIST_DELETE);
      await guard.recheckEntry(row.id);
      return true;
    });
  }
}

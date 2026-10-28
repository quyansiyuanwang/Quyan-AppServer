import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { CONFIG_KEYS } from "@/constant/config-keys";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { activeIamAccountUsers, iamAccountDenied } from "../users/iam-account-principal";
import { ConflictError } from "@/util/errors";
import type { SupportConfigGuard, SupportConfigSnapshot, SupportConfigStore } from "./support-config.store";
const keys = Object.values(CONFIG_KEYS.SUPPORT_AI);
const select = { id: true, key: true, status: true, value: true, updateTime: true } as const;
export class SupportConfigRepository implements SupportConfigStore {
  private static instance: SupportConfigRepository;
  static getInstance() {
    return (this.instance ??= new SupportConfigRepository());
  }
  groupSnapshot(principal: IamPrincipal) {
    return platformManagementGroupSnapshot(principal, Permission.SUPPORT_AI_CONFIG);
  }
  async snapshot(principal: IamPrincipal) {
    await this.groupSnapshot(principal);
    const rows = await prisma.serverConfig.findMany({ where: { key: { in: keys } }, select });
    if (rows.some((r) => r.status !== 1)) throw iamAccountDenied();
    return rows;
  }
  private same(current: readonly SupportConfigSnapshot[], expected: readonly SupportConfigSnapshot[]) {
    if (
      current.length !== expected.length ||
      current.some(
        (r) =>
          r.status !== 1 ||
          !expected.some(
            (e) =>
              e.id === r.id &&
              e.key === r.key &&
              e.value === r.value &&
              e.updateTime.getTime() === r.updateTime.getTime(),
          ),
      )
    )
      throw iamAccountDenied();
  }
  async recheck(guard: SupportConfigGuard) {
    await guard.users.recheck();
    const group = await this.groupSnapshot(guard.users.principal);
    if (group.id !== guard.group.id || group.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
    const users = await prisma.user.findMany({
      where: {
        ...activeIamAccountUsers(guard.users.principal.accountOwnerId),
        id: { in: guard.users.users.map((row) => row.id) },
      },
      select: { id: true, updateTime: true },
    });
    if (
      users.length !== guard.users.users.length ||
      users.some(
        (row) =>
          !guard.users.users.some(
            (expected) => expected.id === row.id && expected.updateTime.getTime() === row.updateTime.getTime(),
          ),
      )
    )
      throw iamAccountDenied();
    this.same(await this.snapshot(guard.users.principal), guard.configs);
  }
  private async identity(tx: Prisma.TransactionClient, guard: SupportConfigGuard) {
    if (guard.users.targetUserId !== guard.users.principal.subjectUserId) throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${guard.group.id} FOR UPDATE`);
    const group = await platformManagementGroupSnapshot(guard.users.principal, Permission.SUPPORT_AI_CONFIG, tx);
    if (group.id !== guard.group.id || group.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
  }
  async update(updates: Readonly<Record<string, string>>, guard: SupportConfigGuard) {
    if (
      guard.action !== "quyan:support:UpdateConfig" ||
      !Object.keys(updates).length ||
      Object.entries(updates).some(
        ([key, value]) => !keys.includes(key as (typeof keys)[number]) || typeof value !== "string",
      )
    )
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.identity(tx, guard);
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM server_configs WHERE \`key\` IN (${Prisma.join(keys)}) ORDER BY id FOR UPDATE`,
          );
          this.same(await tx.serverConfig.findMany({ where: { key: { in: keys } }, select }), guard.configs);
          for (const [key, value] of Object.entries(updates))
            await tx.serverConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
          await this.identity(tx, guard);
          const rows = await tx.serverConfig.findMany({
            where: { key: { in: keys }, status: 1 },
            select: { key: true, value: true },
          });
          return Object.fromEntries(rows.map((r) => [r.key, r.value]));
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("Support configuration context changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}

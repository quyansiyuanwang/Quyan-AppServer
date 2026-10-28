import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { activeIamAccountUsers, iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import {
  isRegisteredConfigurationKey,
  PLATFORM_CONFIGURATION_KEYS,
} from "@/iam/resources/platform-configuration-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { ConflictError } from "@/util/errors";
import type {
  ConfigurationTarget,
  PlatformConfigurationGuard,
  PlatformConfigurationStore,
} from "./platform-configuration.store";
const metadata = { id: true, key: true, status: true, updateTime: true } as const;
export class PlatformConfigurationRepository implements PlatformConfigurationStore {
  private static instance: PlatformConfigurationRepository;
  static getInstance() {
    return (this.instance ??= new PlatformConfigurationRepository());
  }
  groupSnapshot(
    principal: IamPrincipal,
    permission: Permission.SYSTEM_CONFIG | Permission.TICKET_REVIEW_UPDATE = Permission.SYSTEM_CONFIG,
  ) {
    return platformManagementGroupSnapshot(principal, permission);
  }
  private validKeys(keys: readonly string[]) {
    if (
      !keys.length ||
      keys.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(keys).size !== keys.length ||
      keys.some((key) => !isRegisteredConfigurationKey(key))
    )
      throw iamAccountDenied();
  }
  async scan(principal: IamPrincipal, after?: string) {
    await this.groupSnapshot(principal);
    if (after !== undefined && !isRegisteredConfigurationKey(after)) throw iamAccountDenied();
    return prisma.serverConfig.findMany({
      where: { status: 1, key: { in: [...PLATFORM_CONFIGURATION_KEYS], ...(after ? { gt: after } : {}) } },
      select: metadata,
      orderBy: { key: "asc" },
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  async targets(principal: IamPrincipal, keys: readonly string[]) {
    await this.groupSnapshot(principal);
    this.validKeys(keys);
    const rows = await prisma.serverConfig.findMany({ where: { key: { in: [...keys] } }, select: metadata });
    if (rows.some((r) => r.status !== 1)) throw iamAccountDenied();
    return rows;
  }
  private same(current: readonly ConfigurationTarget[], expected: readonly ConfigurationTarget[]) {
    if (
      current.length !== expected.length ||
      current.some(
        (r) =>
          r.status !== 1 ||
          !expected.some((e) => e.id === r.id && e.key === r.key && e.updateTime.getTime() === r.updateTime.getTime()),
      )
    )
      throw iamAccountDenied();
  }
  async hydrate(principal: IamPrincipal, targets: readonly ConfigurationTarget[]) {
    await this.groupSnapshot(principal);
    if (!targets.length) return [];
    this.validKeys(targets.map((t) => t.key));
    const rows = await prisma.serverConfig.findMany({
      where: { status: 1, OR: targets.map((t) => ({ id: t.id, key: t.key, updateTime: t.updateTime })) },
      select: { ...metadata, value: true },
    });
    this.same(rows, targets);
    return rows;
  }
  async recheck(guard: PlatformConfigurationGuard) {
    await guard.users.recheck();
    const group = await this.groupSnapshot(guard.users.principal);
    if (group.id !== guard.group.id || group.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
    const users = await prisma.user.findMany({
      where: {
        ...activeIamAccountUsers(guard.users.principal.accountOwnerId),
        id: { in: guard.users.users.map((u) => u.id) },
      },
      select: { id: true, updateTime: true },
    });
    if (
      users.length !== guard.users.users.length ||
      users.some(
        (u) => !guard.users.users.some((e) => e.id === u.id && e.updateTime.getTime() === u.updateTime.getTime()),
      )
    )
      throw iamAccountDenied();
    if (guard.keys.length) this.same(await this.targets(guard.users.principal, guard.keys), guard.targets);
  }
  private async identity(tx: Prisma.TransactionClient, guard: PlatformConfigurationGuard) {
    if (guard.users.targetUserId !== guard.users.principal.subjectUserId) throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${guard.group.id} FOR UPDATE`);
    const group = await platformManagementGroupSnapshot(guard.users.principal, Permission.SYSTEM_CONFIG, tx);
    if (group.id !== guard.group.id || group.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
  }
  async update(updates: Readonly<Record<string, string>>, guard: PlatformConfigurationGuard) {
    if (guard.action !== "quyan:system:UpdateConfigurations") throw iamAccountDenied();
    const keys = Object.keys(updates);
    this.validKeys(keys);
    if (
      keys.length !== guard.keys.length ||
      keys.some((key) => !guard.keys.includes(key) || typeof updates[key] !== "string")
    )
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.identity(tx, guard);
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM server_configs WHERE \`key\` IN (${Prisma.join([...guard.keys])}) ORDER BY id FOR UPDATE`,
          );
          this.same(
            await tx.serverConfig.findMany({ where: { key: { in: [...guard.keys] } }, select: metadata }),
            guard.targets,
          );
          for (const key of keys.sort())
            await tx.serverConfig.upsert({
              where: { key },
              create: { key, value: updates[key] },
              update: { value: updates[key] },
            });
          await this.identity(tx, guard);
          return tx.serverConfig.findMany({
            where: { key: { in: keys }, status: 1 },
            select: { ...metadata, value: true },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("Configuration context changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}

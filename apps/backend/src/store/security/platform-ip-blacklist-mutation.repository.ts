import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { platformIpAddressIdentifier } from "@/iam/resources/platform-ip-address-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { ConflictError } from "@/util/errors";
import { RECORD_STATUS } from "@/constant/status";
import { assertIamAccountPrincipal, iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import type {
  IpBlacklistMutationTarget,
  IpBlacklistCreateInput,
  IpBlacklistUpdateInput,
  IpBlacklistMutationGuard,
  PlatformIpBlacklistMutationStore,
} from "./platform-ip-blacklist-mutation.store";
const metadata = { id: true, ipAddress: true, status: true, updateTime: true } as const;
export class PlatformIpBlacklistMutationRepository implements PlatformIpBlacklistMutationStore {
  private static instance: PlatformIpBlacklistMutationRepository;
  static getInstance() {
    return (this.instance ??= new PlatformIpBlacklistMutationRepository());
  }
  async authorizationRevision(principal: IamPrincipal) {
    await assertIamAccountPrincipal(principal);
    return readIamAuthorizationRevision(prisma, principal.accountOwnerId);
  }
  async target(ip: string) {
    if (!platformIpAddressIdentifier(ip)) throw iamAccountDenied();
    return prisma.iPBlackList.findUnique({ where: { ipAddress: ip }, select: metadata });
  }
  private validateTarget(target: IpBlacklistMutationTarget, active = true) {
    if (
      !isPlatformLogResourceId(target.id) ||
      !platformIpAddressIdentifier(target.ipAddress) ||
      (active && target.status !== RECORD_STATUS.ACTIVE) ||
      !(target.updateTime instanceof Date) ||
      !Number.isFinite(target.updateTime.getTime())
    )
      throw iamAccountDenied();
  }
  private async identity(tx: Prisma.TransactionClient, guard: IpBlacklistMutationGuard, permission: Permission) {
    if (
      !guard.group ||
      !(guard.group.updateTime instanceof Date) ||
      !Number.isFinite(guard.group.updateTime.getTime()) ||
      !/^[a-f0-9]{64}$/.test(guard.authorizationRevision)
    )
      throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.principal.subjectUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${guard.group.id} FOR UPDATE`);
    const group = await platformManagementGroupSnapshot(guard.users.principal, permission, tx);
    if (
      group.id !== guard.group.id ||
      group.updateTime.getTime() !== guard.group.updateTime.getTime() ||
      (await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !== guard.authorizationRevision
    )
      throw iamAccountDenied();
  }
  private sameTarget(current: IpBlacklistMutationTarget | null, target: IpBlacklistMutationTarget | null) {
    if (!target) {
      if (current) throw iamAccountDenied();
      return;
    }
    if (
      !current ||
      current.id !== target.id ||
      current.status !== target.status ||
      current.ipAddress !== target.ipAddress ||
      current.updateTime.getTime() !== target.updateTime.getTime()
    )
      throw iamAccountDenied();
  }
  private async transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("Blacklist authorization or record changed", undefined, {
          messageKey: "errors.conflict",
        });
      throw error;
    }
  }
  async create(
    target: IpBlacklistMutationTarget | null,
    input: IpBlacklistCreateInput,
    guard: IpBlacklistMutationGuard,
  ) {
    if (
      guard.action !== "quyan:system:ip_blacklist:CreateBlacklist" ||
      !platformIpAddressIdentifier(input.ipAddress) ||
      typeof input.reason !== "string" ||
      input.reason.length > 500 ||
      !(input.expireTime instanceof Date) ||
      !Number.isFinite(input.expireTime.getTime())
    )
      throw iamAccountDenied();
    if (target) {
      this.validateTarget(target, false);
      if (target.ipAddress !== input.ipAddress) throw iamAccountDenied();
    }
    return this.transaction(async (tx) => {
      await this.identity(tx, guard, Permission.IP_BLACKLIST_CREATE);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ip_black_lists WHERE ipAddress = ${input.ipAddress} FOR UPDATE`);
      const current = await tx.iPBlackList.findUnique({ where: { ipAddress: input.ipAddress }, select: metadata });
      this.sameTarget(current, target);
      await guard.users.recheck();
      if (current?.status === RECORD_STATUS.ACTIVE)
        throw new ConflictError("IP already has an active blacklist record", undefined, {
          messageKey: "errors.conflict",
        });
      const data = {
        ipAddress: input.ipAddress,
        status: RECORD_STATUS.ACTIVE,
        ExpireTime: input.expireTime,
        reason: input.reason,
        bannedBy: guard.users.principal.subjectUserId,
        banType: "manual",
        banLevel: 0,
      };
      return current ? tx.iPBlackList.update({ where: { id: current.id }, data }) : tx.iPBlackList.create({ data });
    });
  }
  async update(target: IpBlacklistMutationTarget, input: IpBlacklistUpdateInput, guard: IpBlacklistMutationGuard) {
    this.validateTarget(target);
    if (
      guard.action !== "quyan:system:ip_blacklist:UpdateBlacklist" ||
      (input.reason !== undefined && (typeof input.reason !== "string" || input.reason.length > 500)) ||
      (input.expireTime !== undefined &&
        (!(input.expireTime instanceof Date) || !Number.isFinite(input.expireTime.getTime())))
    )
      throw iamAccountDenied();
    return this.transaction(async (tx) => {
      await this.identity(tx, guard, Permission.IP_BLACKLIST_UPDATE);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ip_black_lists WHERE id = ${target.id} FOR UPDATE`);
      this.sameTarget(await tx.iPBlackList.findUnique({ where: { id: target.id }, select: metadata }), target);
      await guard.users.recheck();
      return tx.iPBlackList.update({
        where: { id: target.id },
        data: {
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          ...(input.expireTime !== undefined ? { ExpireTime: input.expireTime } : {}),
        },
      });
    });
  }
  async remove(target: IpBlacklistMutationTarget, guard: IpBlacklistMutationGuard) {
    this.validateTarget(target);
    if (guard.action !== "quyan:system:ip_blacklist:DeleteBlacklist") throw iamAccountDenied();
    return this.transaction(async (tx) => {
      await this.identity(tx, guard, Permission.IP_BLACKLIST_DELETE);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ip_black_lists WHERE id = ${target.id} FOR UPDATE`);
      this.sameTarget(await tx.iPBlackList.findUnique({ where: { id: target.id }, select: metadata }), target);
      await guard.users.recheck();
      await tx.iPBlackList.update({ where: { id: target.id }, data: { status: RECORD_STATUS.DELETED } });
      return true;
    });
  }
}

import { Prisma } from "@prisma/client";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { platformIpAddressIdentifier } from "@/iam/resources/platform-ip-address-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { ConflictError } from "@/util/errors";
import { assertIamAccountPrincipal, iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import type {
  IpBlacklistMutationTarget,
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
  async authorizationRevision(principal: Parameters<PlatformIpBlacklistMutationStore["authorizationRevision"]>[0]) {
    await assertIamAccountPrincipal(principal);
    return readIamAuthorizationRevision(prisma, principal.accountOwnerId);
  }
  async target(ip: string) {
    if (!platformIpAddressIdentifier(ip)) throw iamAccountDenied();
    return prisma.iPBlackList.findUnique({ where: { ipAddress: ip }, select: metadata });
  }
  async update(target: IpBlacklistMutationTarget, input: IpBlacklistUpdateInput, guard: IpBlacklistMutationGuard) {
    if (
      !isPlatformLogResourceId(target.id) ||
      !platformIpAddressIdentifier(target.ipAddress) ||
      target.status !== 1 ||
      !(target.updateTime instanceof Date) ||
      !Number.isFinite(target.updateTime.getTime()) ||
      !guard.group ||
      !(guard.group.updateTime instanceof Date) ||
      !Number.isFinite(guard.group.updateTime.getTime()) ||
      !/^[a-f0-9]{64}$/.test(guard.authorizationRevision) ||
      (input.reason !== undefined && (typeof input.reason !== "string" || input.reason.length > 500)) ||
      (input.expireTime !== undefined &&
        (!(input.expireTime instanceof Date) || !Number.isFinite(input.expireTime.getTime())))
    )
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await assertIamAccountUserMutation(tx, guard.users, guard.users.principal.subjectUserId);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${guard.group.id} FOR UPDATE`);
          const group = await platformManagementGroupSnapshot(
            guard.users.principal,
            Permission.IP_BLACKLIST_UPDATE,
            tx,
          );
          if (
            group.id !== guard.group.id ||
            group.updateTime.getTime() !== guard.group.updateTime.getTime() ||
            (await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !==
              guard.authorizationRevision
          )
            throw iamAccountDenied();
          await tx.$queryRaw(Prisma.sql`SELECT id FROM ip_black_lists WHERE id = ${target.id} FOR UPDATE`);
          const current = await tx.iPBlackList.findUnique({ where: { id: target.id }, select: metadata });
          if (
            !current ||
            current.status !== 1 ||
            current.ipAddress !== target.ipAddress ||
            current.updateTime.getTime() !== target.updateTime.getTime()
          )
            throw iamAccountDenied();
          await guard.users.recheck();
          return tx.iPBlackList.update({
            where: { id: target.id },
            data: {
              ...(input.reason !== undefined ? { reason: input.reason } : {}),
              ...(input.expireTime !== undefined ? { ExpireTime: input.expireTime } : {}),
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("Blacklist authorization or record changed", undefined, {
          messageKey: "errors.conflict",
        });
      throw error;
    }
  }
}

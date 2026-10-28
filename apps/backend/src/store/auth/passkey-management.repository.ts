import { Prisma } from "@prisma/client";
import { MANAGED_STATUS, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { ForbiddenError, ConflictError } from "@/util/errors";
import type { PasskeyActorSnapshot, PasskeyManagementStore, PasskeyTarget } from "./passkey-management.store";
export const passkeyDenied = () =>
  new ForbiddenError("Passkey identity or resource unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });
const targetSelect = { id: true, userId: true, createTime: true, updateTime: true } as const;
const publicSelect = { ...targetSelect, credentialId: true, name: true, deviceType: true, backedUp: true } as const;
/** Credential key material is excluded from every management query. */
export class PasskeyManagementRepository implements PasskeyManagementStore {
  private static instance: PasskeyManagementRepository;
  static getInstance() {
    return (this.instance ??= new PasskeyManagementRepository());
  }
  private async currentActor(tx: Prisma.TransactionClient, principal: IamPrincipal): Promise<PasskeyActorSnapshot> {
    if (principal.subjectUserId !== principal.principalUserId) throw passkeyDenied();
    const actor = await tx.user.findUnique({
      where: { id: principal.subjectUserId },
      select: { id: true, username: true, name: true, accountOwnerId: true, status: true, updateTime: true },
    });
    const owner = await tx.user.findUnique({
      where: { id: principal.accountOwnerId },
      select: { id: true, accountOwnerId: true, status: true, updateTime: true },
    });
    if (
      !actor ||
      !owner ||
      actor.status !== MANAGED_STATUS.ENABLED ||
      owner.status !== MANAGED_STATUS.ENABLED ||
      (actor.accountOwnerId || actor.id) !== principal.accountOwnerId ||
      (owner.accountOwnerId || owner.id) !== principal.accountOwnerId
    )
      throw passkeyDenied();
    if (principal.subjectType === "assumed_role" || principal.roleSessionId || principal.assumedRoleId) {
      if (principal.subjectType !== "assumed_role" || !principal.roleSessionId || !principal.assumedRoleId)
        throw passkeyDenied();
      const session = await tx.ramRoleSession.findUnique({
        where: { id: principal.roleSessionId },
        include: { role: { select: { id: true, accountOwnerId: true, status: true } } },
      });
      if (
        !session ||
        session.status !== MANAGED_STATUS.ENABLED ||
        session.revokedAt ||
        session.expiresAt <= new Date() ||
        session.subjectUserId !== actor.id ||
        session.accountOwnerId !== principal.accountOwnerId ||
        session.roleId !== principal.assumedRoleId ||
        session.role.id !== principal.assumedRoleId ||
        session.role.status !== MANAGED_STATUS.ENABLED ||
        session.role.accountOwnerId !== principal.accountOwnerId
      )
        throw passkeyDenied();
    }
    return {
      id: actor.id,
      username: actor.username,
      name: actor.name,
      updateTime: actor.updateTime,
      ownerUpdateTime: owner.updateTime,
    };
  }
  private async transaction<T>(principal: IamPrincipal, work: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.currentActor(tx, principal);
          return work(tx);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("Passkey management state changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
  actor(principal: IamPrincipal) {
    return this.currentActor(prisma, principal);
  }
  private userWhere(principal: IamPrincipal) {
    return {
      userId: principal.subjectUserId,
      user: {
        status: MANAGED_STATUS.ENABLED,
        OR: [{ accountOwnerId: principal.accountOwnerId }, { id: principal.accountOwnerId, accountOwnerId: null }],
      },
    };
  }
  async scan(principal: IamPrincipal, after?: PasskeyTarget) {
    await this.actor(principal);
    return prisma.passkeyCredential.findMany({
      where: {
        ...this.userWhere(principal),
        ...(after
          ? { OR: [{ createTime: { lt: after.createTime } }, { createTime: after.createTime, id: { lt: after.id } }] }
          : {}),
      },
      select: targetSelect,
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  async target(principal: IamPrincipal, credentialId: string) {
    await this.actor(principal);
    return prisma.passkeyCredential.findFirst({
      where: { ...this.userWhere(principal), credentialId },
      select: targetSelect,
    });
  }
  async hydrate(principal: IamPrincipal, targets: readonly PasskeyTarget[]) {
    await this.actor(principal);
    if (!targets.length) return [];
    if (
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      targets.some((t) => t.userId !== principal.subjectUserId)
    )
      throw passkeyDenied();
    const rows = await prisma.passkeyCredential.findMany({
      where: { ...this.userWhere(principal), OR: targets.map((t) => ({ id: t.id, updateTime: t.updateTime })) },
      select: publicSelect,
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
    });
    return rows.map((c) => ({
      id: c.id,
      credentialId: c.credentialId,
      name: c.name ?? undefined,
      deviceType: c.deviceType ?? undefined,
      backedUp: c.backedUp,
      createdAt: c.createTime.toISOString(),
    }));
  }
  create(principal: IamPrincipal, snapshot: PasskeyActorSnapshot, data: Prisma.PasskeyCredentialUncheckedCreateInput) {
    return this.transaction(principal, async (tx) => {
      const current = await this.currentActor(tx, principal);
      if (
        data.userId !== current.id ||
        snapshot.id !== current.id ||
        snapshot.updateTime.getTime() !== current.updateTime.getTime() ||
        snapshot.ownerUpdateTime.getTime() !== current.ownerUpdateTime.getTime()
      )
        throw passkeyDenied();
      await tx.passkeyCredential.create({ data, select: { id: true } });
    });
  }
  revoke(principal: IamPrincipal, target: PasskeyTarget) {
    return this.transaction(principal, async (tx) => {
      if (target.userId !== principal.subjectUserId) throw passkeyDenied();
      const deleted = await tx.passkeyCredential.deleteMany({
        where: { ...this.userWhere(principal), id: target.id, updateTime: target.updateTime },
      });
      if (deleted.count !== 1) throw passkeyDenied();
    });
  }
}

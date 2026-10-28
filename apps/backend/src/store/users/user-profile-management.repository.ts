import { USER_EMAIL_CHANGE_WINDOW_MS } from "@/constant/user-email";
import { OperationType } from "@/constant/operation-type";
import { BadRequestError } from "@/util/errors";
import { createHash } from "node:crypto";
import { readIamAuthorizationRevision } from "./iam-authorization-revision";
import { Prisma } from "@prisma/client";
import { MANAGED_STATUS, getOAuthScopeAliases, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import type { UserDto } from "@/api/dto/users/user.dto";
import { ConflictError, ForbiddenError } from "@/util/errors";

export const userProfileAuthorizationDenied = () =>
  new ForbiddenError("User profile identity or target unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });
const conflict = () =>
  new ConflictError("User profile changed after authorization", undefined, { messageKey: "errors.conflict" });
const metadataSelect = { id: true, accountOwnerId: true, groupId: true, status: true, updateTime: true } as const;
export type UserProfileTarget = Prisma.UserGetPayload<{ select: typeof metadataSelect }>;
export interface UserProfileIdentity {
  principal: IamPrincipal;
  oauth?: { id: string; clientId: string; scope?: "profile" | "email" };
}
export interface UserEmailAuthorizationSnapshot {
  target: UserProfileTarget;
  revision: string;
}
const viewSelect = { ...metadataSelect, username: true, email: true, name: true, createTime: true } as const;

/** This request-only projection never selects password, permission JSON or security credentials. */
export class UserProfileManagementRepository {
  private static instance: UserProfileManagementRepository;
  static getInstance() {
    return (this.instance ??= new UserProfileManagementRepository());
  }
  private async actor(tx: Prisma.TransactionClient, identity: UserProfileIdentity) {
    const { principal, oauth } = identity;
    if (principal.subjectUserId !== principal.principalUserId) throw userProfileAuthorizationDenied();
    const user = await tx.user.findUnique({ where: { id: principal.subjectUserId }, select: metadataSelect });
    const owner = await tx.user.findUnique({
      where: { id: principal.accountOwnerId },
      select: { id: true, accountOwnerId: true, status: true },
    });
    if (
      !user ||
      user.status !== MANAGED_STATUS.ENABLED ||
      (user.accountOwnerId || user.id) !== principal.accountOwnerId ||
      !owner ||
      owner.status !== MANAGED_STATUS.ENABLED ||
      (owner.accountOwnerId || owner.id) !== principal.accountOwnerId
    )
      throw userProfileAuthorizationDenied();
    if (principal.subjectType === "assumed_role" || principal.assumedRoleId || principal.roleSessionId) {
      if (principal.subjectType !== "assumed_role" || !principal.assumedRoleId || !principal.roleSessionId)
        throw userProfileAuthorizationDenied();
      const session = await tx.ramRoleSession.findUnique({
        where: { id: principal.roleSessionId },
        select: {
          roleId: true,
          accountOwnerId: true,
          subjectUserId: true,
          status: true,
          revokedAt: true,
          expiresAt: true,
          role: { select: { id: true, accountOwnerId: true, status: true } },
        },
      });
      if (
        !session ||
        session.roleId !== principal.assumedRoleId ||
        session.subjectUserId !== user.id ||
        session.accountOwnerId !== principal.accountOwnerId ||
        session.status !== MANAGED_STATUS.ENABLED ||
        session.revokedAt ||
        session.expiresAt <= new Date() ||
        session.role.id !== principal.assumedRoleId ||
        session.role.accountOwnerId !== principal.accountOwnerId ||
        session.role.status !== MANAGED_STATUS.ENABLED
      )
        throw userProfileAuthorizationDenied();
    }
    if (oauth) {
      const token = await tx.oAuthAccessToken.findUnique({
        where: { id: oauth.id },
        select: {
          userId: true,
          oauthClientId: true,
          status: true,
          revokedAt: true,
          expiresAt: true,
          scopes: true,
          oauthClient: { select: { status: true, reviewStatus: true, scopes: true } },
        },
      });
      const hasRequiredScope = (scopes: unknown) =>
        Array.isArray(scopes) && getOAuthScopeAliases(oauth.scope ?? "profile").some((scope) => scopes.includes(scope));
      if (
        !token ||
        token.userId !== user.id ||
        token.oauthClientId !== oauth.clientId ||
        token.status !== MANAGED_STATUS.ENABLED ||
        token.revokedAt ||
        token.expiresAt <= new Date() ||
        !hasRequiredScope(token.scopes) ||
        token.oauthClient.status !== MANAGED_STATUS.ENABLED ||
        token.oauthClient.reviewStatus !== "approved" ||
        !hasRequiredScope(token.oauthClient.scopes)
      )
        throw userProfileAuthorizationDenied();
    }
    if (user.groupId) {
      const group = await tx.group.findUnique({
        where: { id: user.groupId },
        select: { accountOwnerId: true, status: true },
      });
      if (
        !group ||
        group.status !== MANAGED_STATUS.ENABLED ||
        (group.accountOwnerId && group.accountOwnerId !== principal.accountOwnerId)
      )
        throw userProfileAuthorizationDenied();
    }
    return user;
  }
  private async transaction<T>(
    identity: UserProfileIdentity,
    work: (tx: Prisma.TransactionClient, current: UserProfileTarget) => Promise<T>,
  ) {
    try {
      return await prisma.$transaction(async (tx) => work(tx, await this.actor(tx, identity)), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw conflict();
      throw error;
    }
  }
  async target(identity: UserProfileIdentity) {
    return this.transaction(identity, async (_tx, current) => current);
  }
  private assertTarget(current: UserProfileTarget, expected: UserProfileTarget) {
    if (
      current.id !== expected.id ||
      current.accountOwnerId !== expected.accountOwnerId ||
      current.groupId !== expected.groupId ||
      current.status !== expected.status ||
      current.updateTime.getTime() !== expected.updateTime.getTime()
    )
      throw conflict();
  }
  private async view(tx: Prisma.TransactionClient, current: UserProfileTarget): Promise<UserDto> {
    const row = await tx.user.findUnique({ where: { id: current.id }, select: viewSelect });
    if (!row) throw userProfileAuthorizationDenied();
    this.assertTarget(row, current);
    const group = row.groupId
      ? await tx.group.findUnique({ where: { id: row.groupId }, select: { name: true, username: true } })
      : null;
    const balance = await tx.balanceAccount.findUnique({ where: { userId: row.id }, select: { balance: true } });
    return {
      id: row.id,
      accountOwnerId: row.accountOwnerId || row.id,
      username: row.username,
      email: row.email,
      name: row.name,
      status: row.status,
      groupId: row.groupId ?? undefined,
      groupName: group?.name || group?.username || null,
      balance: balance ? Number(balance.balance) : 0,
      createdAt: row.createTime.toISOString(),
      updatedAt: row.updateTime.toISOString(),
    };
  }
  async hydrate(identity: UserProfileIdentity, expected: UserProfileTarget) {
    return this.transaction(identity, async (tx, current) => {
      this.assertTarget(current, expected);
      return this.view(tx, current);
    });
  }
  async update(identity: UserProfileIdentity, expected: UserProfileTarget, data: { name?: string }) {
    return this.transaction(identity, async (tx, current) => {
      this.assertTarget(current, expected);
      if (data.name !== undefined) {
        const result = await tx.user.updateMany({
          where: {
            id: current.id,
            accountOwnerId: current.accountOwnerId,
            groupId: current.groupId,
            status: MANAGED_STATUS.ENABLED,
            updateTime: current.updateTime,
          },
          data: { name: data.name },
        });
        if (result.count !== 1) throw conflict();
      }
      const updated = await tx.user.findUnique({ where: { id: current.id }, select: metadataSelect });
      if (!updated) throw userProfileAuthorizationDenied();
      return this.view(tx, updated);
    });
  }
  private async emailRevision(tx: Prisma.TransactionClient, identity: UserProfileIdentity, current: UserProfileTarget) {
    const owner = await tx.user.findUnique({
      where: { id: identity.principal.accountOwnerId },
      select: metadataSelect,
    });
    const group = current.groupId
      ? await tx.group.findUnique({
          where: { id: current.groupId },
          select: { id: true, status: true, accountOwnerId: true, updateTime: true, permissions: true },
        })
      : null;
    const iam = await readIamAuthorizationRevision(tx, identity.principal.accountOwnerId);
    return createHash("sha256").update(JSON.stringify({ owner, group, iam })).digest("hex");
  }
  async emailSnapshot(identity: UserProfileIdentity): Promise<UserEmailAuthorizationSnapshot> {
    return this.transaction(identity, async (tx, current) => ({
      target: current,
      revision: await this.emailRevision(tx, identity, current),
    }));
  }
  private async emailGuard(
    tx: Prisma.TransactionClient,
    identity: UserProfileIdentity,
    current: UserProfileTarget,
    expected: UserEmailAuthorizationSnapshot,
    recheck: () => Promise<void>,
  ) {
    this.assertTarget(current, expected.target);
    if ((await this.emailRevision(tx, identity, current)) !== expected.revision) throw userProfileAuthorizationDenied();
    await recheck();
  }
  async recheckEmail(
    identity: UserProfileIdentity,
    expected: UserEmailAuthorizationSnapshot,
    recheck: () => Promise<void>,
  ) {
    return this.transaction(identity, async (tx, current) => this.emailGuard(tx, identity, current, expected, recheck));
  }
  async updateEmail(
    identity: UserProfileIdentity,
    expected: UserEmailAuthorizationSnapshot,
    email: string,
    recheck: () => Promise<void>,
  ) {
    return this.transaction(identity, async (tx, current) => {
      await this.emailGuard(tx, identity, current, expected, recheck);
      // Preserve uniqueness and the daily business rule at the actual write boundary.
      if (await tx.user.findFirst({ where: { email, status: { not: MANAGED_STATUS.DELETED } }, select: { id: true } }))
        throw new BadRequestError("Email belongs to another user", undefined, { messageKey: "user.emailTaken" });
      if (
        await tx.businessLog.findFirst({
          where: {
            status: MANAGED_STATUS.ENABLED,
            actorUserId: current.id,
            operationType: OperationType.USER_EMAIL_CHANGE,
            success: true,
            createTime: { gte: new Date(Date.now() - USER_EMAIL_CHANGE_WINDOW_MS) },
          },
          select: { id: true },
        })
      )
        throw new BadRequestError("Email change is limited to once per day", undefined, {
          messageKey: "user.emailChangeTooFrequent",
        });
      const result = await tx.user.updateMany({
        where: {
          id: current.id,
          accountOwnerId: current.accountOwnerId,
          groupId: current.groupId,
          status: MANAGED_STATUS.ENABLED,
          updateTime: current.updateTime,
        },
        data: { email },
      });
      if (result.count !== 1) throw conflict();
    });
  }
}

import { Prisma, type AccessKey, type User } from "@prisma/client";
import { maskSecret, toCanonicalCredential, MANAGED_STATUS, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@/util/errors";
import { CustomCode } from "@quyan/shared";
import type { AccessKeyCreateInput } from "./accesskey.store";
import type { AccessKeyDto } from "@/api/dto/users/accesskey.dto";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { IamManagementPage } from "@/iam/management-pagination";
/** Captured before step-up; only trusted request state can supply this snapshot. */
export type AccessKeyIssuanceSnapshot = Pick<
  User,
  "id" | "email" | "twoFactorEnabled" | "twoFactorPasskeyRequired" | "accountOwnerId" | "status"
> & { revision: string };
export interface AccessKeyIssuanceState {
  principal: IamPrincipal;
  snapshot: AccessKeyIssuanceSnapshot;
  oauth?: { id: string; clientId: string };
}
const issuanceSelect = {
  id: true,
  email: true,
  twoFactorEnabled: true,
  twoFactorPasskeyRequired: true,
  accountOwnerId: true,
  status: true,
  updateTime: true,
} as const;
const invalidVerificationCode = () =>
  new BadRequestError("Invalid or expired access key verification code", CustomCode.VERIFICATION_CODE_INVALID, {
    messageKey: "errors.verificationCodeInvalid",
  });
export type AccessKeyTarget = Pick<AccessKey, "id" | "userId" | "status" | "updateTime" | "createTime">;
const targetSelect = { id: true, userId: true, status: true, updateTime: true, createTime: true } as const;
export const accessKeyAuthorizationDenied = () =>
  new ForbiddenError("Access key identity or target unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });
const conflict = () =>
  new ConflictError("Access key target changed after authorization", undefined, { messageKey: "errors.conflict" });
const viewSelect = {
  ...targetSelect,
  name: true,
  key: true,
  expiresAt: true,
  lastUsedAt: true,
  requestCount: true,
} satisfies Prisma.AccessKeySelect;
type AccessKeyView = Prisma.AccessKeyGetPayload<{ select: typeof viewSelect }>;
function maskedView(row: AccessKeyView): AccessKeyDto {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name ?? undefined,
    key: maskSecret(toCanonicalCredential(row.key, "accessKey")),
    expiresAt: row.expiresAt?.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString(),
    requestCount: row.requestCount,
    createTime: row.createTime.toISOString(),
  };
}
/** Metadata before authorization; guarded hydration returns only a masked public projection. */
export class AccessKeyManagementRepository {
  private static instance: AccessKeyManagementRepository;
  static getInstance() {
    return (this.instance ??= new AccessKeyManagementRepository());
  }
  private async actor(tx: Prisma.TransactionClient, principal: IamPrincipal) {
    if (principal.subjectUserId !== principal.principalUserId) throw accessKeyAuthorizationDenied();
    const actor = await tx.user.findUnique({
      where: { id: principal.subjectUserId },
      select: { id: true, accountOwnerId: true, status: true },
    });
    const owner = await tx.user.findUnique({
      where: { id: principal.accountOwnerId },
      select: { id: true, accountOwnerId: true, status: true },
    });
    if (
      !actor ||
      actor.status !== MANAGED_STATUS.ENABLED ||
      (actor.accountOwnerId || actor.id) !== principal.accountOwnerId ||
      !owner ||
      owner.status !== MANAGED_STATUS.ENABLED ||
      (owner.accountOwnerId || owner.id) !== principal.accountOwnerId
    )
      throw accessKeyAuthorizationDenied();
    if (principal.subjectType === "assumed_role" || principal.assumedRoleId || principal.roleSessionId) {
      if (principal.subjectType !== "assumed_role" || !principal.roleSessionId || !principal.assumedRoleId)
        throw accessKeyAuthorizationDenied();
      const session = await tx.ramRoleSession.findUnique({
        where: { id: principal.roleSessionId },
        include: { role: { select: { id: true, status: true, accountOwnerId: true } } },
      });
      if (
        !session ||
        session.status !== MANAGED_STATUS.ENABLED ||
        session.subjectUserId !== actor.id ||
        session.accountOwnerId !== principal.accountOwnerId ||
        session.roleId !== principal.assumedRoleId ||
        session.revokedAt ||
        session.expiresAt <= new Date() ||
        session.role.id !== principal.assumedRoleId ||
        session.role.status !== MANAGED_STATUS.ENABLED ||
        session.role.accountOwnerId !== principal.accountOwnerId
      )
        throw accessKeyAuthorizationDenied();
    }
  }
  private async transaction<T>(principal: IamPrincipal, work: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.actor(tx, principal);
          return work(tx);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw conflict();
      throw error;
    }
  }
  private async issuanceSnapshot(tx: Prisma.TransactionClient, principal: IamPrincipal) {
    const row = await tx.user.findUnique({ where: { id: principal.subjectUserId }, select: issuanceSelect });
    if (
      !row ||
      row.status !== MANAGED_STATUS.ENABLED ||
      !row.email ||
      (row.accountOwnerId || row.id) !== principal.accountOwnerId
    )
      throw accessKeyAuthorizationDenied();
    const { updateTime, ...snapshot } = row;
    return { ...snapshot, revision: updateTime.toISOString() };
  }
  private async checkIssuance(tx: Prisma.TransactionClient, state: AccessKeyIssuanceState) {
    const current = await this.issuanceSnapshot(tx, state.principal),
      expected = state.snapshot;
    if (
      current.id !== expected.id ||
      current.revision !== expected.revision ||
      current.email !== expected.email ||
      current.twoFactorEnabled !== expected.twoFactorEnabled ||
      current.twoFactorPasskeyRequired !== expected.twoFactorPasskeyRequired ||
      current.accountOwnerId !== expected.accountOwnerId ||
      current.status !== expected.status
    )
      throw conflict();
    if (state.oauth) {
      const token = await tx.oAuthAccessToken.findUnique({
        where: { id: state.oauth.id },
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
      if (
        !token ||
        token.userId !== current.id ||
        token.oauthClientId !== state.oauth.clientId ||
        token.status !== MANAGED_STATUS.ENABLED ||
        token.revokedAt ||
        token.expiresAt <= new Date() ||
        !Array.isArray(token.scopes) ||
        !token.scopes.includes("accesskey") ||
        token.oauthClient.status !== MANAGED_STATUS.ENABLED ||
        token.oauthClient.reviewStatus !== "approved" ||
        !Array.isArray(token.oauthClient.scopes) ||
        !token.oauthClient.scopes.includes("accesskey")
      )
        throw accessKeyAuthorizationDenied();
    }
  }
  async captureIssuance(
    principal: IamPrincipal,
    oauth?: AccessKeyIssuanceState["oauth"],
  ): Promise<AccessKeyIssuanceState> {
    return this.transaction(principal, async (tx) => {
      const state = {
        principal: { ...principal },
        snapshot: await this.issuanceSnapshot(tx, principal),
        ...(oauth ? { oauth: { ...oauth } } : {}),
      };
      await this.checkIssuance(tx, state);
      return state;
    });
  }
  async checkIssuanceState(state: AccessKeyIssuanceState) {
    await this.transaction(state.principal, (tx) => this.checkIssuance(tx, state));
  }
  async issue(state: AccessKeyIssuanceState, data: AccessKeyCreateInput, verificationCode?: string) {
    return this.transaction(state.principal, async (tx) => {
      await this.checkIssuance(tx, state);
      if (data.userId !== state.principal.subjectUserId || data.userId !== state.snapshot.id)
        throw accessKeyAuthorizationDenied();
      if (!state.snapshot.twoFactorEnabled) {
        const code = verificationCode?.trim();
        if (!code) throw invalidVerificationCode();
        const record = await tx.emailVerification.findFirst({
          where: { email: state.snapshot.email!, code, used: false, expiresAt: { gt: new Date() } },
          select: { id: true },
          orderBy: { createTime: "desc" },
        });
        if (!record) throw invalidVerificationCode();
        const consumed = await tx.emailVerification.updateMany({
          where: { id: record.id, used: false, expiresAt: { gt: new Date() } },
          data: { used: true },
        });
        if (consumed.count !== 1) throw invalidVerificationCode();
      }
      return tx.accessKey.create({ data });
    });
  }
  async assertPrincipal(principal: IamPrincipal) {
    await this.transaction(principal, async () => undefined);
  }
  /** Bounded metadata only; credential columns are not fetched until authorization completes. */
  async candidates(principal: IamPrincipal, page: IamManagementPage): Promise<AccessKeyTarget[]> {
    return this.transaction(principal, (tx) =>
      tx.accessKey.findMany({
        where: { userId: principal.subjectUserId, status: MANAGED_STATUS.ENABLED },
        select: targetSelect,
        orderBy: [{ createTime: "desc" }, { id: "desc" }],
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize + 1,
      }),
    );
  }
  async scan(principal: IamPrincipal, after?: AccessKeyTarget): Promise<AccessKeyTarget[]> {
    return this.transaction(principal, (tx) =>
      tx.accessKey.findMany({
        where: {
          userId: principal.subjectUserId,
          status: MANAGED_STATUS.ENABLED,
          ...(after && {
            OR: [{ createTime: { lt: after.createTime } }, { createTime: after.createTime, id: { lt: after.id } }],
          }),
        },
        select: targetSelect,
        orderBy: [{ createTime: "desc" }, { id: "desc" }],
        take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
      }),
    );
  }
  async hydrate(principal: IamPrincipal, expected: readonly AccessKeyTarget[]): Promise<AccessKeyDto[]> {
    return this.transaction(principal, async (tx) => {
      if (
        expected.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        expected.some((row) => row.userId !== principal.subjectUserId || row.status !== MANAGED_STATUS.ENABLED)
      )
        throw accessKeyAuthorizationDenied();
      const where = {
        id: { in: expected.map((row) => row.id) },
        userId: principal.subjectUserId,
        status: MANAGED_STATUS.ENABLED,
      };
      // Recheck metadata before touching credential columns, in the same serializable transaction.
      const current = await tx.accessKey.findMany({ where, select: targetSelect });
      const currentById = new Map(current.map((row) => [row.id, row]));
      for (const snapshot of expected) {
        const row = currentById.get(snapshot.id);
        if (
          !row ||
          row.updateTime.getTime() !== snapshot.updateTime.getTime() ||
          row.createTime.getTime() !== snapshot.createTime.getTime()
        )
          throw conflict();
      }
      const rows = await tx.accessKey.findMany({ where, select: viewSelect });
      const byId = new Map(rows.map((row) => [row.id, row]));
      return expected.map((snapshot) => {
        const row = byId.get(snapshot.id);
        if (
          !row ||
          row.updateTime.getTime() !== snapshot.updateTime.getTime() ||
          row.createTime.getTime() !== snapshot.createTime.getTime()
        )
          throw conflict();
        return maskedView(row);
      });
    });
  }
  /** Legacy/shadow caller must pass its legacy permission gate first. Still bounded and masked. */
  async legacyPage(userId: string, page: IamManagementPage) {
    const rows = await prisma.accessKey.findMany({
      where: { userId, status: MANAGED_STATUS.ENABLED },
      select: viewSelect,
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize + 1,
    });
    return { ...page, items: rows.slice(0, page.pageSize).map(maskedView), hasNext: rows.length > page.pageSize };
  }
  async target(principal: IamPrincipal, id: string): Promise<AccessKeyTarget> {
    return this.transaction(principal, async (tx) => {
      const target = await tx.accessKey.findFirst({
        where: { id, userId: principal.subjectUserId, status: MANAGED_STATUS.ENABLED },
        select: targetSelect,
      });
      if (!target) throw new NotFoundError("Access key not found", undefined, { messageKey: "accessKey.notFound" });
      return target;
    });
  }
  async revoke(principal: IamPrincipal, expected: AccessKeyTarget) {
    return this.transaction(principal, async (tx) => {
      if (expected.userId !== principal.subjectUserId || expected.status !== MANAGED_STATUS.ENABLED)
        throw accessKeyAuthorizationDenied();
      const result = await tx.accessKey.updateMany({
        where: {
          id: expected.id,
          userId: principal.subjectUserId,
          status: MANAGED_STATUS.ENABLED,
          updateTime: expected.updateTime,
        },
        data: { status: MANAGED_STATUS.DELETED },
      });
      if (result.count !== 1) throw conflict();
      return expected;
    });
  }
}

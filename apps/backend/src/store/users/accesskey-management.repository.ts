import { Prisma, type AccessKey } from "@prisma/client";
import { maskSecret, toCanonicalCredential, MANAGED_STATUS, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { ConflictError, ForbiddenError, NotFoundError } from "@/util/errors";
import type { AccessKeyDto } from "@/api/dto/users/accesskey.dto";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { IamManagementPage } from "@/iam/management-pagination";
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

import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { platformManagementGroupSnapshot } from "./platform-management-principal";
import { iamAccountDenied } from "./iam-account-principal";
import { assertIamAccountUserMutation } from "./iam-account-user-mutation";
import { OAUTH_CLIENT_VIEW_SELECT } from "./oauth-client-management.repository";
import { isCanonicalOAuthClientId } from "@/iam/resources/oauth-client-resources";
import { ConflictError } from "@/util/errors";
import type {
  PlatformOAuthReviewDecision,
  PlatformOAuthReviewMutationGuard,
  PlatformOAuthReviewMutationStore,
} from "./platform-oauth-review-mutation.store";
const metadata = {
  id: true,
  userId: true,
  status: true,
  isSystemClient: true,
  createTime: true,
  updateTime: true,
  submittedAt: true,
  reviewStatus: true,
} as const;
export class PlatformOAuthReviewMutationRepository implements PlatformOAuthReviewMutationStore {
  private static instance: PlatformOAuthReviewMutationRepository;
  static getInstance() {
    return (this.instance ??= new PlatformOAuthReviewMutationRepository());
  }
  groupSnapshot(principal: IamPrincipal) {
    return platformManagementGroupSnapshot(principal, Permission.OAUTH_CLIENT_REVIEW_UPDATE);
  }
  async target(principal: IamPrincipal, id: string) {
    await this.groupSnapshot(principal);
    if (!isCanonicalOAuthClientId(id)) throw iamAccountDenied();
    return prisma.oAuthClient.findFirst({ where: { id, status: 1, isSystemClient: false }, select: metadata });
  }
  async hydrate(principal: IamPrincipal, target: PlatformOAuthReviewMutationGuard["target"]) {
    await this.groupSnapshot(principal);
    const where = {
      id: target.id,
      userId: target.userId,
      status: 1,
      isSystemClient: false,
      updateTime: target.updateTime,
    };
    const row = await prisma.oAuthClient.findFirst({ where, select: OAUTH_CLIENT_VIEW_SELECT });
    return row
      ? {
          ...row,
          hasClientSecret: !!(await prisma.oAuthClient.count({ where: { ...where, clientSecretHash: { not: null } } })),
        }
      : null;
  }
  private async checkIdentity(tx: Prisma.TransactionClient, guard: PlatformOAuthReviewMutationGuard) {
    if (guard.users.targetUserId !== guard.users.principal.subjectUserId) throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${guard.group.id} FOR UPDATE`);
    const current = await platformManagementGroupSnapshot(
      guard.users.principal,
      Permission.OAUTH_CLIENT_REVIEW_UPDATE,
      tx,
    );
    if (current.id !== guard.group.id || current.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
  }
  async mutate(guard: PlatformOAuthReviewMutationGuard, decision?: PlatformOAuthReviewDecision) {
    const { target, users, action } = guard;
    const reviewing = action === "quyan:oauth:ReviewClient";
    if (
      target.status !== 1 ||
      target.isSystemClient !== false ||
      !isCanonicalOAuthClientId(target.id) ||
      !isCanonicalOAuthClientId(target.userId) ||
      (!reviewing && action !== "quyan:oauth:DeleteReviewedClient") ||
      (reviewing
        ? !decision ||
          target.reviewStatus !== "pending" ||
          !["approved", "rejected"].includes(decision.reviewStatus) ||
          Object.keys(decision).some((k) => !["reviewStatus", "reviewComment"].includes(k))
        : decision !== undefined)
    )
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.checkIdentity(tx, guard);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM oauth_clients WHERE id = ${target.id} FOR UPDATE`);
          const where = {
            id: target.id,
            userId: target.userId,
            status: 1,
            isSystemClient: false,
            reviewStatus: target.reviewStatus,
            updateTime: target.updateTime,
          };
          const data = reviewing
            ? {
                reviewStatus: decision!.reviewStatus,
                reviewComment: decision!.reviewComment,
                reviewedAt: new Date(),
                reviewedByUserId: users.principal.subjectUserId,
              }
            : { status: -1 };
          if ((await tx.oAuthClient.updateMany({ where, data })).count !== 1) throw iamAccountDenied();
          await this.checkIdentity(tx, guard);
          if (!reviewing) return undefined;
          const row = await tx.oAuthClient.findFirst({
            where: { id: target.id, userId: target.userId, status: 1, isSystemClient: false },
            select: OAUTH_CLIENT_VIEW_SELECT,
          });
          if (!row) throw iamAccountDenied();
          return {
            ...row,
            hasClientSecret: !!(await tx.oAuthClient.count({
              where: { id: target.id, clientSecretHash: { not: null } },
            })),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("OAuth review context changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}

import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { platformManagementGroupSnapshot } from "./platform-management-principal";
import { iamAccountDenied } from "./iam-account-principal";
import { assertIamAccountUserMutation } from "./iam-account-user-mutation";
import { AUTH_CENTER_CLIENT_VIEW_SELECT } from "./auth-center-client-management.repository";
import { isCanonicalOAuthClientId } from "@/iam/resources/oauth-client-resources";
import { ConflictError } from "@/util/errors";
import type {
  PlatformAuthCenterReviewDecision,
  PlatformAuthCenterReviewMutationGuard,
  PlatformAuthCenterReviewMutationStore,
} from "./platform-auth-center-review-mutation.store";
const metadata = {
  id: true,
  userId: true,
  status: true,
  createTime: true,
  updateTime: true,
  submittedAt: true,
  reviewStatus: true,
} as const;
export class PlatformAuthCenterReviewMutationRepository implements PlatformAuthCenterReviewMutationStore {
  private static instance: PlatformAuthCenterReviewMutationRepository;
  static getInstance() {
    return (this.instance ??= new PlatformAuthCenterReviewMutationRepository());
  }
  groupSnapshot(principal: IamPrincipal) {
    return platformManagementGroupSnapshot(principal, Permission.AUTH_CENTER_CLIENT_REVIEW_UPDATE);
  }
  async target(principal: IamPrincipal, id: string) {
    await this.groupSnapshot(principal);
    if (!isCanonicalOAuthClientId(id)) throw iamAccountDenied();
    return prisma.authCenterClient.findFirst({ where: { id, status: 1 }, select: metadata });
  }
  async hydrate(principal: IamPrincipal, target: PlatformAuthCenterReviewMutationGuard["target"]) {
    await this.groupSnapshot(principal);
    const where = {
      id: target.id,
      userId: target.userId,
      status: 1,
      updateTime: target.updateTime,
    };
    const row = await prisma.authCenterClient.findFirst({ where, select: AUTH_CENTER_CLIENT_VIEW_SELECT });
    return row
      ? {
          ...row,
          hasClientSecret: !!(await prisma.authCenterClient.count({
            where: { ...where, clientSecretHash: { not: null } },
          })),
        }
      : null;
  }
  private async checkIdentity(tx: Prisma.TransactionClient, guard: PlatformAuthCenterReviewMutationGuard) {
    if (guard.users.targetUserId !== guard.users.principal.subjectUserId) throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${guard.group.id} FOR UPDATE`);
    const current = await platformManagementGroupSnapshot(
      guard.users.principal,
      Permission.AUTH_CENTER_CLIENT_REVIEW_UPDATE,
      tx,
    );
    if (current.id !== guard.group.id || current.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
  }
  async mutate(guard: PlatformAuthCenterReviewMutationGuard, decision?: PlatformAuthCenterReviewDecision) {
    const { target, users, action } = guard;
    const reviewing = action === "quyan:auth_center:ReviewClient";
    if (
      target.status !== 1 ||
      !isCanonicalOAuthClientId(target.id) ||
      !isCanonicalOAuthClientId(target.userId) ||
      (!reviewing && action !== "quyan:auth_center:DeleteReviewedClient") ||
      (reviewing
        ? !decision ||
          target.reviewStatus !== "pending" ||
          !["approved", "rejected"].includes(decision.reviewStatus) ||
          (decision.reviewComment !== null &&
            (typeof decision.reviewComment !== "string" || decision.reviewComment.length > 2000)) ||
          Object.keys(decision).some((k) => !["reviewStatus", "reviewComment"].includes(k))
        : decision !== undefined)
    )
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.checkIdentity(tx, guard);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM auth_center_clients WHERE id = ${target.id} FOR UPDATE`);
          const where = {
            id: target.id,
            userId: target.userId,
            status: 1,
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
          if ((await tx.authCenterClient.updateMany({ where, data })).count !== 1) throw iamAccountDenied();
          if (!reviewing) {
            await this.checkIdentity(tx, guard);
            return undefined;
          }
          const row = await tx.authCenterClient.findFirst({
            where: { id: target.id, userId: target.userId, status: 1 },
            select: AUTH_CENTER_CLIENT_VIEW_SELECT,
          });
          if (!row) throw iamAccountDenied();
          const hasClientSecret = !!(await tx.authCenterClient.count({
            where: { id: target.id, clientSecretHash: { not: null } },
          }));
          await this.checkIdentity(tx, guard);
          return { ...row, hasClientSecret };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("Auth Center review context changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}

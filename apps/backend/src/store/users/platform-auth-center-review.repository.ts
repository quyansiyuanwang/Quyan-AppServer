import { prisma } from "@/config/database";
import type { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { iamAccountDenied } from "./iam-account-principal";
import { platformManagementGroupSnapshot } from "./platform-management-principal";
import { AUTH_CENTER_CLIENT_VIEW_SELECT } from "./auth-center-client-management.repository";
import type {
  PlatformAuthCenterReviewStore,
  PlatformAuthCenterReviewTarget,
} from "./platform-auth-center-review.store";
import type { AuthCenterClientReviewListFilters } from "./auth-center-client.store";
import { isCanonicalOAuthClientId } from "@/iam/resources/oauth-client-resources";
const metadata = {
  id: true,
  userId: true,
  status: true,
  createTime: true,
  updateTime: true,
  submittedAt: true,
} as const;
export class PlatformAuthCenterReviewRepository implements PlatformAuthCenterReviewStore {
  private static instance: PlatformAuthCenterReviewRepository;
  static getInstance() {
    return (this.instance ??= new PlatformAuthCenterReviewRepository());
  }
  async assertActor(principal: IamPrincipal) {
    await platformManagementGroupSnapshot(principal, Permission.AUTH_CENTER_CLIENT_REVIEW_READ);
  }
  private filter(filters: AuthCenterClientReviewListFilters): Prisma.AuthCenterClientWhereInput {
    return {
      status: 1,
      ...(filters.reviewStatus ? { reviewStatus: filters.reviewStatus } : {}),
      ...(filters.keyword
        ? {
            OR: [
              { name: { contains: filters.keyword } },
              { clientId: { contains: filters.keyword } },
              { user: { username: { contains: filters.keyword } } },
            ],
          }
        : {}),
    };
  }
  async scan(principal: IamPrincipal, filters: AuthCenterClientReviewListFilters, after?: string) {
    await this.assertActor(principal);
    if (after !== undefined && !isCanonicalOAuthClientId(after)) throw iamAccountDenied();
    return prisma.authCenterClient.findMany({
      where: { ...this.filter(filters), ...(after ? { id: { gt: after } } : {}) },
      select: metadata,
      orderBy: { id: "asc" },
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  private where(targets: readonly PlatformAuthCenterReviewTarget[]): Prisma.AuthCenterClientWhereInput {
    if (
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      targets.some((t) => !isCanonicalOAuthClientId(t.id) || !isCanonicalOAuthClientId(t.userId) || t.status !== 1)
    )
      throw iamAccountDenied();
    return {
      status: 1,
      OR: targets.map((t) => ({ id: t.id, userId: t.userId, updateTime: t.updateTime })),
    };
  }
  async hydrate(principal: IamPrincipal, targets: readonly PlatformAuthCenterReviewTarget[]) {
    await this.assertActor(principal);
    if (!targets.length) return [];
    const where = this.where(targets),
      rows = await prisma.authCenterClient.findMany({
        where,
        select: {
          ...AUTH_CENTER_CLIENT_VIEW_SELECT,
          user: { select: { id: true, username: true } },
          reviewedBy: { select: { id: true, username: true } },
        },
      });
    const ids = new Set(
      (
        await prisma.authCenterClient.findMany({
          where: { ...where, clientSecretHash: { not: null } },
          select: { id: true },
        })
      ).map((r) => r.id),
    );
    return rows.map((r) => ({ ...r, hasClientSecret: ids.has(r.id) }));
  }
  async recheck(
    principal: IamPrincipal,
    targets: readonly PlatformAuthCenterReviewTarget[],
    filters: AuthCenterClientReviewListFilters,
  ) {
    await this.assertActor(principal);
    if (!targets.length) return [];
    return prisma.authCenterClient.findMany({
      where: { AND: [this.where(targets), this.filter(filters)] },
      select: metadata,
    });
  }
}

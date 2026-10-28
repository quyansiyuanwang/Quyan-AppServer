import { prisma } from "@/config/database";
import type { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { iamAccountDenied } from "./iam-account-principal";
import { platformManagementGroupSnapshot } from "./platform-management-principal";
import { OAUTH_CLIENT_VIEW_SELECT } from "./oauth-client-management.repository";
import type { PlatformOAuthReviewStore, PlatformOAuthReviewTarget } from "./platform-oauth-review.store";
import type { OAuthClientReviewListFilters } from "./oauth-client.store";
import { isCanonicalOAuthClientId } from "@/iam/resources/oauth-client-resources";
const metadata = {
  id: true,
  userId: true,
  status: true,
  isSystemClient: true,
  createTime: true,
  updateTime: true,
  submittedAt: true,
} as const;
export class PlatformOAuthReviewRepository implements PlatformOAuthReviewStore {
  private static instance: PlatformOAuthReviewRepository;
  static getInstance() {
    return (this.instance ??= new PlatformOAuthReviewRepository());
  }
  async assertActor(principal: IamPrincipal) {
    await platformManagementGroupSnapshot(principal, Permission.OAUTH_CLIENT_REVIEW_READ);
  }
  private filter(filters: OAuthClientReviewListFilters): Prisma.OAuthClientWhereInput {
    return {
      status: 1,
      isSystemClient: false,
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
  async scan(principal: IamPrincipal, filters: OAuthClientReviewListFilters, after?: string) {
    await this.assertActor(principal);
    if (after !== undefined && !isCanonicalOAuthClientId(after)) throw iamAccountDenied();
    return prisma.oAuthClient.findMany({
      where: { ...this.filter(filters), ...(after ? { id: { gt: after } } : {}) },
      select: metadata,
      orderBy: { id: "asc" },
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  private where(targets: readonly PlatformOAuthReviewTarget[]): Prisma.OAuthClientWhereInput {
    if (
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      targets.some(
        (t) =>
          !isCanonicalOAuthClientId(t.id) ||
          !isCanonicalOAuthClientId(t.userId) ||
          t.status !== 1 ||
          t.isSystemClient !== false,
      )
    )
      throw iamAccountDenied();
    return {
      status: 1,
      isSystemClient: false,
      OR: targets.map((t) => ({ id: t.id, userId: t.userId, updateTime: t.updateTime })),
    };
  }
  async hydrate(principal: IamPrincipal, targets: readonly PlatformOAuthReviewTarget[]) {
    await this.assertActor(principal);
    if (!targets.length) return [];
    const where = this.where(targets),
      rows = await prisma.oAuthClient.findMany({
        where,
        select: {
          ...OAUTH_CLIENT_VIEW_SELECT,
          user: { select: { id: true, username: true } },
          reviewedBy: { select: { id: true, username: true } },
        },
      });
    const ids = new Set(
      (
        await prisma.oAuthClient.findMany({
          where: { ...where, clientSecretHash: { not: null } },
          select: { id: true },
        })
      ).map((r) => r.id),
    );
    return rows.map((r) => ({ ...r, hasClientSecret: ids.has(r.id) }));
  }
  async recheck(
    principal: IamPrincipal,
    targets: readonly PlatformOAuthReviewTarget[],
    filters: OAuthClientReviewListFilters,
  ) {
    await this.assertActor(principal);
    if (!targets.length) return [];
    return prisma.oAuthClient.findMany({
      where: { AND: [this.where(targets), this.filter(filters)] },
      select: metadata,
    });
  }
}

import { prisma } from "@/config/database";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { parseLegacyPermissions } from "@/iam/legacy-policy";
import { assertIamAccountPrincipal, iamAccountDenied } from "./iam-account-principal";
import { OAUTH_CLIENT_VIEW_SELECT } from "./oauth-client-management.repository";
import type { PlatformOAuthClientStore } from "./platform-oauth-client.store";
import type { OAuthClientTarget } from "./oauth-client-management.store";
import { isCanonicalOAuthClientId } from "@/iam/resources/oauth-client-resources";
const metadata = {
  id: true,
  userId: true,
  status: true,
  isSystemClient: true,
  createTime: true,
  updateTime: true,
} as const;
export class PlatformOAuthClientRepository implements PlatformOAuthClientStore {
  private static instance: PlatformOAuthClientRepository;
  static getInstance() {
    return (this.instance ??= new PlatformOAuthClientRepository());
  }
  async assertActor(principal: IamPrincipal) {
    await assertIamAccountPrincipal(principal);
    const actor = await prisma.user.findUnique({
      where: { id: principal.subjectUserId },
      select: { groupId: true, group: { select: { id: true, accountOwnerId: true, status: true, permissions: true } } },
    });
    if (
      !actor?.group ||
      actor.groupId !== actor.group.id ||
      actor.group.status !== 1 ||
      actor.group.accountOwnerId !== null ||
      !parseLegacyPermissions(actor.group.permissions).includes(Permission.OAUTH_CLIENT_SYSTEM_MANAGE)
    )
      throw iamAccountDenied();
  }
  async scan(principal: IamPrincipal, after?: string) {
    await this.assertActor(principal);
    if (after !== undefined && !isCanonicalOAuthClientId(after)) throw iamAccountDenied();
    return prisma.oAuthClient.findMany({
      where: { status: 1, isSystemClient: true, ...(after ? { id: { gt: after } } : {}) },
      select: metadata,
      orderBy: { id: "asc" },
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  private where(targets: readonly OAuthClientTarget[]) {
    if (
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      targets.some((t) => !isCanonicalOAuthClientId(t.id) || t.status !== 1 || t.isSystemClient !== true)
    )
      throw iamAccountDenied();
    return {
      status: 1,
      isSystemClient: true,
      OR: targets.map((t) => ({ id: t.id, userId: t.userId, updateTime: t.updateTime })),
    };
  }
  async hydrate(principal: IamPrincipal, targets: readonly OAuthClientTarget[]) {
    await this.assertActor(principal);
    if (!targets.length) return [];
    const where = this.where(targets),
      rows = await prisma.oAuthClient.findMany({
        where,
        select: OAUTH_CLIENT_VIEW_SELECT,
        orderBy: [{ createTime: "desc" }, { id: "desc" }],
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
  async recheck(principal: IamPrincipal, targets: readonly OAuthClientTarget[]) {
    await this.assertActor(principal);
    if (!targets.length) return [];
    return prisma.oAuthClient.findMany({ where: this.where(targets), select: metadata });
  }
}

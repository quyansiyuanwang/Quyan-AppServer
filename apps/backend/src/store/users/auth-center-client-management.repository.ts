import { prisma } from "@/config/database";
import { assertOAuthClientIdentity } from "./oauth-client-management.repository";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isCanonicalOAuthClientId } from "@/iam/resources/oauth-client-resources";
import { activeIamAccountUsers, iamAccountDenied } from "./iam-account-principal";
import type {
  OAuthClientIdentity,
  AuthCenterClientManagementStore,
  AuthCenterClientTarget,
} from "./auth-center-client-management.store";
const metadata = {
  id: true,
  userId: true,
  status: true,
  createTime: true,
  updateTime: true,
} as const;
// No credential hashes or token relations are selected by this management read boundary.
export const AUTH_CENTER_CLIENT_VIEW_SELECT = {
  ...metadata,
  reviewedByUserId: true,
  name: true,
  description: true,
  clientId: true,
  clientSecretPreview: true,
  clientType: true,
  reviewStatus: true,
  reviewComment: true,
  submittedAt: true,
  reviewedAt: true,
  grantTypes: true,
  redirectUris: true,
  scopes: true,
  homepageUrl: true,
  logoUrl: true,
  policyUrl: true,
  tosUrl: true,
  isPkceRequired: true,
  accessTokenLifetime: true,
  refreshTokenLifetime: true,
  lastUsedAt: true,
} as const;
export class AuthCenterClientManagementRepository implements AuthCenterClientManagementStore {
  private static instance: AuthCenterClientManagementRepository;
  static getInstance() {
    return (this.instance ??= new AuthCenterClientManagementRepository());
  }
  assertActor(identity: OAuthClientIdentity) {
    return assertOAuthClientIdentity(identity, prisma, "auth_center_client");
  }
  private owned(identity: OAuthClientIdentity) {
    return {
      userId: identity.principal.subjectUserId,
      status: 1,
      user: activeIamAccountUsers(identity.principal.accountOwnerId),
    };
  }
  async scan(identity: OAuthClientIdentity, after?: AuthCenterClientTarget) {
    await this.assertActor(identity);
    return prisma.authCenterClient.findMany({
      where: {
        ...this.owned(identity),
        ...(after
          ? { OR: [{ createTime: { lt: after.createTime } }, { createTime: after.createTime, id: { lt: after.id } }] }
          : {}),
      },
      select: metadata,
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  async target(identity: OAuthClientIdentity, id: string) {
    await this.assertActor(identity);
    if (!isCanonicalOAuthClientId(id)) throw iamAccountDenied();
    return prisma.authCenterClient.findFirst({ where: { ...this.owned(identity), id }, select: metadata });
  }
  async recheck(identity: OAuthClientIdentity, targets: readonly AuthCenterClientTarget[]) {
    await this.assertActor(identity);
    if (!targets.length) return [];
    if (targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) throw iamAccountDenied();
    return prisma.authCenterClient.findMany({
      where: { ...this.owned(identity), OR: targets.map((t) => ({ id: t.id, updateTime: t.updateTime })) },
      select: metadata,
    });
  }
  async hydrate(identity: OAuthClientIdentity, targets: readonly AuthCenterClientTarget[]) {
    await this.assertActor(identity);
    if (!targets.length) return [];
    if (
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      targets.some(
        (t) => !isCanonicalOAuthClientId(t.id) || t.userId !== identity.principal.subjectUserId || t.status !== 1,
      )
    )
      throw iamAccountDenied();
    const where = { ...this.owned(identity), OR: targets.map((t) => ({ id: t.id, updateTime: t.updateTime })) };
    const rows = await prisma.authCenterClient.findMany({
      where,
      select: AUTH_CENTER_CLIENT_VIEW_SELECT,
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
    });
    // Query presence only; never fetch the hash just to produce hasClientSecret.
    const secretIds = new Set(
      (
        await prisma.authCenterClient.findMany({
          where: { ...where, clientSecretHash: { not: null } },
          select: { id: true },
        })
      ).map((r) => r.id),
    );
    await this.assertActor(identity);
    return rows.map((row) => ({ ...row, hasClientSecret: secretIds.has(row.id) }));
  }
}

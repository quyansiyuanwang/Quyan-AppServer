import { prisma } from "@/config/database";
import type { Prisma } from "@prisma/client";
import { getOAuthScopeAliases } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isCanonicalOAuthClientId } from "@/iam/resources/oauth-client-resources";
import { activeIamAccountUsers, assertIamAccountPrincipal, iamAccountDenied } from "./iam-account-principal";
import type {
  OAuthClientIdentity,
  OAuthClientManagementStore,
  OAuthClientTarget,
} from "./oauth-client-management.store";
const metadata = {
  id: true,
  userId: true,
  status: true,
  isSystemClient: true,
  createTime: true,
  updateTime: true,
} as const;
// No credential hashes or token relations are selected by this management read boundary.
export const OAUTH_CLIENT_VIEW_SELECT = {
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
export async function assertOAuthClientIdentity(identity: OAuthClientIdentity, tx: Prisma.TransactionClient = prisma) {
  await assertIamAccountPrincipal(identity.principal, tx);
  if (!identity.oauth) return;
  const token = await tx.oAuthAccessToken.findFirst({
    where: {
      id: identity.oauth.id,
      oauthClientId: identity.oauth.clientId,
      userId: identity.principal.subjectUserId,
      status: 1,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      oauthClient: { status: 1, reviewStatus: "approved" },
    },
    select: { scopes: true, oauthClient: { select: { scopes: true } } },
  });
  const hasScope = (scopes: unknown) =>
    Array.isArray(scopes) && getOAuthScopeAliases("oauth_client").some((s) => scopes.includes(s));
  if (!token || !hasScope(token.scopes) || !hasScope(token.oauthClient.scopes)) throw iamAccountDenied();
}

export class OAuthClientManagementRepository implements OAuthClientManagementStore {
  private static instance: OAuthClientManagementRepository;
  static getInstance() {
    return (this.instance ??= new OAuthClientManagementRepository());
  }
  assertActor(identity: OAuthClientIdentity) {
    return assertOAuthClientIdentity(identity);
  }
  private owned(identity: OAuthClientIdentity) {
    return {
      userId: identity.principal.subjectUserId,
      status: 1,
      isSystemClient: false,
      user: activeIamAccountUsers(identity.principal.accountOwnerId),
    };
  }
  async scan(identity: OAuthClientIdentity, after?: OAuthClientTarget) {
    await this.assertActor(identity);
    return prisma.oAuthClient.findMany({
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
    return prisma.oAuthClient.findFirst({ where: { ...this.owned(identity), id }, select: metadata });
  }
  async recheck(identity: OAuthClientIdentity, targets: readonly OAuthClientTarget[]) {
    await this.assertActor(identity);
    if (!targets.length) return [];
    if (targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) throw iamAccountDenied();
    return prisma.oAuthClient.findMany({
      where: { ...this.owned(identity), OR: targets.map((t) => ({ id: t.id, updateTime: t.updateTime })) },
      select: metadata,
    });
  }
  async hydrate(identity: OAuthClientIdentity, targets: readonly OAuthClientTarget[]) {
    await this.assertActor(identity);
    if (!targets.length) return [];
    if (
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      targets.some(
        (t) =>
          !isCanonicalOAuthClientId(t.id) ||
          t.userId !== identity.principal.subjectUserId ||
          t.status !== 1 ||
          t.isSystemClient,
      )
    )
      throw iamAccountDenied();
    const where = { ...this.owned(identity), OR: targets.map((t) => ({ id: t.id, updateTime: t.updateTime })) };
    const rows = await prisma.oAuthClient.findMany({
      where,
      select: OAUTH_CLIENT_VIEW_SELECT,
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
    });
    // Query presence only; never fetch the hash just to produce hasClientSecret.
    const secretIds = new Set(
      (
        await prisma.oAuthClient.findMany({
          where: { ...where, clientSecretHash: { not: null } },
          select: { id: true },
        })
      ).map((r) => r.id),
    );
    await this.assertActor(identity);
    return rows.map((row) => ({ ...row, hasClientSecret: secretIds.has(row.id) }));
  }
}

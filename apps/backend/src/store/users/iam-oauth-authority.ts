import type { Prisma } from "@prisma/client";
import { getOAuthScopeAliases, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { iamAccountDenied } from "./iam-account-principal";
/** Capture only authorization data; usage counters cannot invalidate concurrent requests. */
export async function captureIamOAuthRevision(
  principal: IamPrincipal,
  binding: { id: string; clientId: string } | undefined,
  requiredScopes: readonly string[],
  tx: Prisma.TransactionClient = prisma,
): Promise<string | undefined> {
  if (!binding) return undefined;
  if (
    !requiredScopes.length ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(binding.id) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(binding.clientId)
  )
    throw iamAccountDenied();
  const token = await tx.oAuthAccessToken.findUnique({
    where: { id: binding.id },
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
  const scoped = (scopes: unknown) =>
    Array.isArray(scopes) &&
    requiredScopes.every((scope) => getOAuthScopeAliases(scope).some((alias) => scopes.includes(alias)));
  if (
    !token ||
    token.userId !== principal.subjectUserId ||
    token.oauthClientId !== binding.clientId ||
    token.status !== 1 ||
    token.revokedAt ||
    token.expiresAt <= new Date() ||
    !scoped(token.scopes) ||
    token.oauthClient.status !== 1 ||
    token.oauthClient.reviewStatus !== "approved" ||
    !scoped(token.oauthClient.scopes)
  )
    throw iamAccountDenied();
  return JSON.stringify({ tokenId: binding.id, clientId: binding.clientId, ...token });
}

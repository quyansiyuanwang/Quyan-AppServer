import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { assertIamAccountUserMutation } from "./iam-account-user-mutation";
import { iamAccountDenied } from "./iam-account-principal";
import { assertOAuthClientIdentity, OAUTH_CLIENT_VIEW_SELECT } from "./oauth-client-management.repository";
import type { OAuthClientMutationGuard, OAuthClientMutationStore } from "./oauth-client-mutation.store";
import type { OAuthClientUpdateInput } from "./oauth-client.store";
import { ConflictError } from "@/util/errors";
export class OAuthClientMutationRepository implements OAuthClientMutationStore {
  private static instance: OAuthClientMutationRepository;
  static getInstance() {
    return (this.instance ??= new OAuthClientMutationRepository());
  }
  update(data: OAuthClientUpdateInput, guard: OAuthClientMutationGuard) {
    return this.mutate(data, guard, false);
  }
  revoke(guard: OAuthClientMutationGuard) {
    return this.mutate({ status: -1 }, guard, true);
  }
  private async mutate(
    data: OAuthClientUpdateInput & { status?: number },
    guard: OAuthClientMutationGuard,
    deleting: boolean,
  ) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const { target, identity, users } = guard;
          if (
            target.userId !== identity.principal.subjectUserId ||
            target.userId !== users.targetUserId ||
            target.status !== 1 ||
            target.isSystemClient !== false ||
            users.principal.accountOwnerId !== identity.principal.accountOwnerId ||
            users.principal.subjectUserId !== identity.principal.subjectUserId ||
            users.principal.roleSessionId !== identity.principal.roleSessionId
          )
            throw iamAccountDenied();
          await assertIamAccountUserMutation(tx, users, target.userId);
          await assertOAuthClientIdentity(identity, tx);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM oauth_clients WHERE id = ${target.id} FOR UPDATE`);
          await guard.scopeCheck?.();
          const where = {
            id: target.id,
            userId: target.userId,
            status: 1,
            isSystemClient: false,
            updateTime: target.updateTime,
          };
          if ((await tx.oAuthClient.updateMany({ where, data })).count !== 1) throw iamAccountDenied();
          await assertIamAccountUserMutation(tx, users, target.userId);
          await assertOAuthClientIdentity(identity, tx);
          await guard.scopeCheck?.();
          const row = await tx.oAuthClient.findFirst({
            where: { id: target.id, userId: target.userId, status: deleting ? -1 : 1, isSystemClient: false },
            select: OAUTH_CLIENT_VIEW_SELECT,
          });
          if (!row) throw iamAccountDenied();
          const hasClientSecret = !!(await tx.oAuthClient.count({
            where: { id: target.id, userId: target.userId, status: deleting ? -1 : 1, clientSecretHash: { not: null } },
          }));
          return { ...row, hasClientSecret };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("OAuth application changed after authorization", undefined, {
          messageKey: "errors.conflict",
        });
      throw error;
    }
  }
}

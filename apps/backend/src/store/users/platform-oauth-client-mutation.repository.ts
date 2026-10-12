import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { iamAccountDenied } from "./iam-account-principal";
import { assertIamAccountUserMutation } from "./iam-account-user-mutation";
import { platformOAuthGroupSnapshot } from "./platform-oauth-client.repository";
import { OAUTH_CLIENT_VIEW_SELECT } from "./oauth-client-management.repository";
import type {
  PlatformOAuthClientCreateGuard,
  PlatformOAuthClientMutationGuard,
  PlatformOAuthClientMutationStore,
} from "./platform-oauth-client-mutation.store";
import type { OAuthClientCreateInput, OAuthClientUpdateInput } from "./oauth-client.store";
import { BadRequestError, ConflictError } from "@/util/errors";
export class PlatformOAuthClientMutationRepository implements PlatformOAuthClientMutationStore {
  private static instance: PlatformOAuthClientMutationRepository;
  static getInstance() {
    return (this.instance ??= new PlatformOAuthClientMutationRepository());
  }
  private async checkIdentity(
    tx: Prisma.TransactionClient,
    guard: PlatformOAuthClientCreateGuard | PlatformOAuthClientMutationGuard,
  ) {
    const { users, group } = guard;
    if (users.targetUserId !== users.principal.subjectUserId) throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, users, users.targetUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${group.id} FOR UPDATE`);
    const current = await platformOAuthGroupSnapshot(users.principal, tx);
    if (current.id !== group.id || current.updateTime.getTime() !== group.updateTime.getTime())
      throw iamAccountDenied();
  }
  async create(data: OAuthClientCreateInput, guard: PlatformOAuthClientCreateGuard) {
    if (
      data.userId !== guard.users.principal.subjectUserId ||
      data.isSystemClient !== true ||
      data.reviewStatus !== "approved" ||
      data.reviewedByUserId !== guard.users.principal.subjectUserId
    )
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.checkIdentity(tx, guard);
          await guard.scopeCheck();
          const row = await tx.oAuthClient.create({
            data: { ...data, status: 1, isSystemClient: true },
            select: OAUTH_CLIENT_VIEW_SELECT,
          });
          await this.checkIdentity(tx, guard);
          await guard.scopeCheck();
          return { ...row, hasClientSecret: !!data.clientSecretHash };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw new BadRequestError("OAuth client ID already exists", undefined, { messageKey: "oauth.clientIdExists" });
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("Platform OAuth creation context changed", undefined, {
          messageKey: "errors.conflict",
        });
      throw error;
    }
  }
  async update(data: OAuthClientUpdateInput, guard: PlatformOAuthClientMutationGuard) {
    if (
      Object.keys(data).some(
        (key) =>
          ![
            "name",
            "description",
            "homepageUrl",
            "logoUrl",
            "policyUrl",
            "tosUrl",
            "scopes",
            "accessTokenLifetime",
            "refreshTokenLifetime",
          ].includes(key),
      )
    )
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          const { target, users } = guard;
          if (
            target.status !== 1 ||
            target.isSystemClient !== true ||
            users.targetUserId !== users.principal.subjectUserId
          )
            throw iamAccountDenied();
          await this.checkIdentity(tx, guard);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM oauth_clients WHERE id = ${target.id} FOR UPDATE`);
          await guard.scopeCheck?.();
          if (
            (
              await tx.oAuthClient.updateMany({
                where: {
                  id: target.id,
                  userId: target.userId,
                  status: 1,
                  isSystemClient: true,
                  updateTime: target.updateTime,
                },
                data,
              })
            ).count !== 1
          )
            throw iamAccountDenied();
          await this.checkIdentity(tx, guard);
          await guard.scopeCheck?.();
          const row = await tx.oAuthClient.findFirst({
            where: { id: target.id, userId: target.userId, status: 1, isSystemClient: true },
            select: OAUTH_CLIENT_VIEW_SELECT,
          });
          if (!row) throw iamAccountDenied();
          const hasClientSecret = !!(await tx.oAuthClient.count({
            where: { id: target.id, status: 1, clientSecretHash: { not: null } },
          }));
          return { ...row, hasClientSecret };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("Platform OAuth application changed after authorization", undefined, {
          messageKey: "errors.conflict",
        });
      throw error;
    }
  }
}

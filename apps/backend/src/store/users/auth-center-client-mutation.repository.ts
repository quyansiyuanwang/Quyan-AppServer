import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { assertIamAccountUserMutation } from "./iam-account-user-mutation";
import { iamAccountDenied } from "./iam-account-principal";
import { assertOAuthClientIdentity } from "./oauth-client-management.repository";
import { AUTH_CENTER_CLIENT_VIEW_SELECT } from "./auth-center-client-management.repository";
import type { AuthCenterClientMutationGuard, AuthCenterClientMutationStore } from "./auth-center-client-mutation.store";
import type { AuthCenterClientUpdateInput } from "./auth-center-client.store";
import { ConflictError } from "@/util/errors";
export class AuthCenterClientMutationRepository implements AuthCenterClientMutationStore {
  private static instance: AuthCenterClientMutationRepository;
  static getInstance() {
    return (this.instance ??= new AuthCenterClientMutationRepository());
  }
  update(data: AuthCenterClientUpdateInput, guard: AuthCenterClientMutationGuard) {
    return this.mutate(data, guard, false);
  }
  revoke(guard: AuthCenterClientMutationGuard) {
    return this.mutate({ status: -1 }, guard, true);
  }
  private assertOperation(
    data: AuthCenterClientUpdateInput & { status?: number },
    guard: AuthCenterClientMutationGuard,
    deleting: boolean,
  ) {
    const keys = Object.keys(data);
    if (deleting) {
      if (guard.action !== "quyan:auth_center:DeleteClient" || keys.length !== 1 || data.status !== -1)
        throw iamAccountDenied();
    } else if (guard.action === "quyan:auth_center:UpdateClient") {
      const allowed = [
        "name",
        "description",
        "redirectUris",
        "scopes",
        "homepageUrl",
        "logoUrl",
        "policyUrl",
        "tosUrl",
        "clientType",
        "grantTypes",
        "isPkceRequired",
        "accessTokenLifetime",
        "refreshTokenLifetime",
        "clientSecretHash",
        "clientSecretPreview",
        "reviewStatus",
        "reviewComment",
        "submittedAt",
        "reviewedAt",
        "reviewedByUserId",
      ];
      if (
        keys.some((k) => !allowed.includes(k)) ||
        (keys.includes("scopes") && !guard.scopeCheck) ||
        (keys.includes("reviewStatus") && data.reviewStatus !== "draft") ||
        ["reviewComment", "submittedAt", "reviewedAt", "reviewedByUserId"].some(
          (k) => keys.includes(k) && data[k as keyof AuthCenterClientUpdateInput] !== null,
        ) ||
        (["clientSecretHash", "clientSecretPreview"].some((k) => keys.includes(k)) &&
          (data.clientType !== "public" || data.clientSecretHash !== null || data.clientSecretPreview !== null))
      )
        throw iamAccountDenied();
    } else if (guard.action === "quyan:auth_center:RotateClientSecret") {
      if (
        keys.length !== 2 ||
        keys.some((k) => !["clientSecretHash", "clientSecretPreview"].includes(k)) ||
        typeof data.clientSecretHash !== "string" ||
        !data.clientSecretHash ||
        typeof data.clientSecretPreview !== "string" ||
        !data.clientSecretPreview
      )
        throw iamAccountDenied();
    } else if (guard.action === "quyan:auth_center:SubmitClientReview") {
      if (
        keys.length !== 5 ||
        keys.some(
          (k) => !["reviewStatus", "submittedAt", "reviewComment", "reviewedAt", "reviewedByUserId"].includes(k),
        ) ||
        data.reviewStatus !== "pending" ||
        !(data.submittedAt instanceof Date) ||
        !Number.isFinite(data.submittedAt.getTime()) ||
        data.reviewComment !== null ||
        data.reviewedAt !== null ||
        data.reviewedByUserId !== null
      )
        throw iamAccountDenied();
    } else throw iamAccountDenied();
  }
  private async mutate(
    data: AuthCenterClientUpdateInput & { status?: number },
    guard: AuthCenterClientMutationGuard,
    deleting: boolean,
  ) {
    this.assertOperation(data, guard, deleting);
    try {
      return await prisma.$transaction(
        async (tx) => {
          const { target, identity, users } = guard;
          if (
            target.userId !== identity.principal.subjectUserId ||
            target.userId !== users.targetUserId ||
            target.status !== 1 ||
            users.principal.accountOwnerId !== identity.principal.accountOwnerId ||
            users.principal.subjectUserId !== identity.principal.subjectUserId ||
            users.principal.roleSessionId !== identity.principal.roleSessionId
          )
            throw iamAccountDenied();
          await assertIamAccountUserMutation(tx, users, target.userId);
          await assertOAuthClientIdentity(identity, tx, "auth_center_client");
          await guard.scopeCheck?.();
          await tx.$queryRaw(Prisma.sql`SELECT id FROM auth_center_clients WHERE id = ${target.id} FOR UPDATE`);
          const where = {
            id: target.id,
            userId: target.userId,
            status: 1,
            updateTime: target.updateTime,
          };
          if (!Object.keys(data).length) {
            if (!(await tx.authCenterClient.findFirst({ where, select: { id: true } }))) throw iamAccountDenied();
          } else if ((await tx.authCenterClient.updateMany({ where, data })).count !== 1) throw iamAccountDenied();
          await assertIamAccountUserMutation(tx, users, target.userId);
          await assertOAuthClientIdentity(identity, tx, "auth_center_client");
          await guard.scopeCheck?.();
          const row = await tx.authCenterClient.findFirst({
            where: { id: target.id, userId: target.userId, status: deleting ? -1 : 1 },
            select: AUTH_CENTER_CLIENT_VIEW_SELECT,
          });
          if (!row) throw iamAccountDenied();
          const hasClientSecret = !!(await tx.authCenterClient.count({
            where: { id: target.id, userId: target.userId, status: deleting ? -1 : 1, clientSecretHash: { not: null } },
          }));
          return { ...row, hasClientSecret };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("Auth center application changed after authorization", undefined, {
          messageKey: "errors.conflict",
        });
      throw error;
    }
  }
}

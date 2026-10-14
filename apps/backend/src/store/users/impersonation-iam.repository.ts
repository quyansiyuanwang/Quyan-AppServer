import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { isPlatformUserId } from "@/iam/resources/platform-user-resources";
import { parseLegacyPermissions } from "@/iam/legacy-policy";
import { assertIamAccountPrincipal, iamAccountDenied } from "./iam-account-principal";
import { readIamAuthorizationRevision } from "./iam-authorization-revision";
import {
  IMPERSONATION_USER_SELECT,
  type ImpersonationIamStore,
  type ImpersonationSnapshot,
} from "./impersonation-iam.store";
import { ConflictError } from "@/util/errors";
const transactionPolicy = Object.freeze({ timeoutMs: 30000 });
export class ImpersonationIamRepository implements ImpersonationIamStore {
  private static instance: ImpersonationIamRepository;
  static getInstance() {
    return (this.instance ??= new ImpersonationIamRepository());
  }
  private async read(
    principal: IamPrincipal,
    targetId: string,
    accessKeyId: string | undefined,
    tx: Prisma.TransactionClient,
  ) {
    if (!isPlatformUserId(targetId) || principal.subjectUserId === targetId) throw iamAccountDenied();
    await assertIamAccountPrincipal(principal, tx);
    const ids = [...new Set([principal.subjectUserId, principal.accountOwnerId, targetId])].sort();
    const users = await tx.user.findMany({
      where: { id: { in: ids }, status: 1 },
      select: IMPERSONATION_USER_SELECT,
      orderBy: { id: "asc" },
    });
    const actor = users.find((user) => user.id === principal.subjectUserId),
      target = users.find((user) => user.id === targetId);
    if (
      users.length !== ids.length ||
      !actor ||
      !target ||
      !actor.group ||
      actor.group.status !== 1 ||
      actor.group.accountOwnerId !== null ||
      !Number.isFinite(actor.group.level) ||
      (target.group && (target.group.status !== 1 || !Number.isFinite(target.group.level))) ||
      (target.group?.level ?? Infinity) <= actor.group.level
    )
      throw iamAccountDenied();
    const permissions = parseLegacyPermissions(actor.group.permissions),
      canAct = permissions.includes(Permission.USER_IMPERSONATE_ACT),
      canView = permissions.includes(Permission.USER_IMPERSONATE_VIEW);
    if (!canAct && !canView) throw iamAccountDenied();
    let key;
    if (principal.subjectType === "access_key") {
      if (!isPlatformUserId(accessKeyId)) throw iamAccountDenied();
      key = await tx.accessKey.findFirst({
        where: { id: accessKeyId, userId: actor.id, status: 1 },
        select: { id: true, userId: true, status: true, expiresAt: true },
      });
      if (!key || (key.expiresAt && key.expiresAt.getTime() <= Date.now())) throw iamAccountDenied();
    } else if (accessKeyId !== undefined) throw iamAccountDenied();
    const revision = createHash("sha256").update(JSON.stringify({ users, key })).digest("hex");
    return {
      actor,
      target,
      revision,
      canAct,
      canView,
      authorizationRevision: await readIamAuthorizationRevision(tx, principal.accountOwnerId),
    };
  }
  snapshot(principal: IamPrincipal, targetId: string, accessKeyId?: string) {
    return this.read(principal, targetId, accessKeyId, prisma);
  }
  async guarded(
    principal: IamPrincipal,
    targetId: string,
    expected: ImpersonationSnapshot,
    recheck: () => Promise<void>,
    accessKeyId?: string,
  ) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const ids = [...new Set([principal.subjectUserId, principal.accountOwnerId, targetId])].sort();
          await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
          const groups = [
            ...new Set([expected.actor.groupId, expected.target.groupId].filter((id): id is string => !!id)),
          ].sort();
          if (groups.length)
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM \`groups\` WHERE id IN (${Prisma.join(groups)}) ORDER BY id FOR UPDATE`,
            );
          if (accessKeyId)
            await tx.$queryRaw(Prisma.sql`SELECT id FROM access_keys WHERE id=${accessKeyId} FOR UPDATE`);
          const current = await this.read(principal, targetId, accessKeyId, tx);
          if (
            current.revision !== expected.revision ||
            current.authorizationRevision !== expected.authorizationRevision
          )
            throw iamAccountDenied();
          await recheck();
          return current;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: transactionPolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("Impersonation authority changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}

import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { ConflictError } from "@/util/errors";
import {
  captureRelayTokenAuthority,
  RELAY_TOKEN_AUTHORITY_REQUIREMENTS,
  type RelayTokenAuthorityIdentity,
  type RelayTokenAuthoritySnapshot,
} from "./relay-token-authority";
/** Deletion never loads credentials, routing configuration, usage or relation payloads. */
const targetSelect = {
  id: true,
  userId: true,
  status: true,
  updateTime: true,
} as const satisfies Prisma.RelayTokenSelect;
export type RelayTokenDeletionTarget = Prisma.RelayTokenGetPayload<{ select: typeof targetSelect }>;
export interface RelayTokenDeletionGuard {
  identity: RelayTokenAuthorityIdentity;
  snapshot: RelayTokenAuthoritySnapshot;
  recheck: (tx?: Prisma.TransactionClient) => Promise<void>;
  authorize: () => Promise<void>;
}
const deletionPolicy = Object.freeze({ timeoutMs: 30000 });
export class RelayTokenDeleteRepository {
  private static instance: RelayTokenDeleteRepository;
  static getInstance() {
    return (this.instance ??= new RelayTokenDeleteRepository());
  }
  async tokenOwner(id: string) {
    if (!isRelayTokenResourceId(id)) throw iamAccountDenied();
    const row = await prisma.relayToken.findUnique({ where: { id }, select: { id: true, userId: true } });
    if (!row || row.id !== id || !isRelayTokenResourceId(row.userId)) throw iamAccountDenied();
    return row.userId;
  }
  snapshot(identity: RelayTokenAuthorityIdentity, tx: Prisma.TransactionClient = prisma) {
    return captureRelayTokenAuthority(identity, RELAY_TOKEN_AUTHORITY_REQUIREMENTS.delete, tx);
  }
  async candidates(userId: string, ids: readonly string[], tx: Prisma.TransactionClient = prisma) {
    if (
      !isRelayTokenResourceId(userId) ||
      !ids.length ||
      ids.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !isRelayTokenResourceId(id))
    )
      throw iamAccountDenied();
    const rows = await tx.relayToken.findMany({
      where: { userId, id: { in: [...ids] }, status: { in: [0, 1] } },
      select: targetSelect,
      orderBy: { id: "asc" },
    });
    if (rows.length !== ids.length || rows.some((row) => row.userId !== userId || !ids.includes(row.id)))
      throw iamAccountDenied();
    return rows;
  }
  async remove(targets: readonly RelayTokenDeletionTarget[], guard: RelayTokenDeletionGuard, persist: boolean) {
    const { identity, snapshot } = guard;
    const userIds = [
      ...new Set([identity.principal.subjectUserId, identity.principal.accountOwnerId, identity.userId]),
    ].sort();
    const ids = targets.map((target) => target.id).sort();
    if (
      !targets.length ||
      targets.some((row) => row.userId !== identity.userId) ||
      new Set(ids).size !== ids.length ||
      ids.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest
    )
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Identity locks precede token locks; requests sharing owners use the same deterministic order.
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(userIds)}) ORDER BY id FOR UPDATE`,
          );
          const groupIds = [
            ...new Set([snapshot.group?.id, snapshot.actorGroup?.id].filter((id): id is string => Boolean(id))),
          ].sort();
          if (groupIds.length)
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM \`groups\` WHERE id IN (${Prisma.join(groupIds)}) ORDER BY id FOR UPDATE`,
            );
          const check = async () => {
            if (JSON.stringify(await this.snapshot(identity, tx)) !== JSON.stringify(snapshot))
              throw iamAccountDenied();
            await guard.recheck(tx);
          };
          await check();
          const revision = await readIamAuthorizationRevision(tx, identity.principal.accountOwnerId);
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM relay_tokens WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
          );
          const current = await this.candidates(identity.userId, ids, tx);
          if (
            current.some(
              (row) =>
                !targets.some(
                  (expected) =>
                    expected.id === row.id &&
                    expected.userId === row.userId &&
                    expected.status === row.status &&
                    expected.updateTime.getTime() === row.updateTime.getTime(),
                ),
            )
          )
            throw iamAccountDenied();
          await check();
          await guard.authorize();
          let affected = 0;
          if (persist) {
            const result = await tx.relayToken.updateMany({
              where: {
                userId: identity.userId,
                OR: targets.map((row) => ({ id: row.id, status: row.status, updateTime: row.updateTime })),
              },
              data: { status: -1 },
            });
            if (result.count !== targets.length) throw iamAccountDenied();
            affected = result.count;
          }
          // Denial here throws out the executed UPDATE too, not merely the HTTP response.
          await check();
          await guard.authorize();
          if ((await readIamAuthorizationRevision(tx, identity.principal.accountOwnerId)) !== revision)
            throw iamAccountDenied();
          return { total: targets.length, affected };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: deletionPolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028"].includes(error.code))
        throw new ConflictError("Token deletion context changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}

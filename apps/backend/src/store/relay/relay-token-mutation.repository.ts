import { RelayTokenUpdateRepository } from "./relay-token-update.repository";
import type { RelayTokenUpdateInput } from "./relay-token.store";
import {
  RelayTokenChannelChangeRepository,
  type RelayTokenChannelChange,
} from "./relay-token-channel-change.repository";
import { RelayChannelSelectionRepository } from "./relay-channel-selection.repository";
import { generateRelayTokenValue } from "@/util/relay/relay-token-credential.util";
import type { ContentSafetyPolicyOverride } from "@quyan/shared";
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
/** Initial admission reads metadata only; operation-specific reads require independent proofs. */
const targetSelect = {
  id: true,
  userId: true,
  status: true,
  updateTime: true,
} as const satisfies Prisma.RelayTokenSelect;
export type RelayTokenMutationTarget = Prisma.RelayTokenGetPayload<{ select: typeof targetSelect }>;
export interface RelayTokenMutationGuard {
  identity: RelayTokenAuthorityIdentity;
  snapshot: RelayTokenAuthoritySnapshot;
  recheck: (tx?: Prisma.TransactionClient) => Promise<void>;
  authorize: () => Promise<void>;
}
export interface RelayTokenFullUpdateChange {
  kind: "update";
  prepare: (tx: Prisma.TransactionClient, persist: boolean) => Promise<RelayTokenUpdateInput>;
  verify: (tx: Prisma.TransactionClient, persisted: boolean) => Promise<void>;
}
export type RelayTokenMutation =
  | RelayTokenChannelChange
  | RelayTokenFullUpdateChange
  | { kind: "delete" }
  | { kind: "toggle" }
  | { kind: "refresh" }
  | { kind: "status"; enabled: boolean }
  | { kind: "content-safety"; config: ContentSafetyPolicyOverride | null };
function mutationData(change: RelayTokenMutation): Prisma.RelayTokenUncheckedUpdateManyInput {
  switch (change.kind) {
    case "update":
      return {}; // Prepared only after admission and source locks in the same transaction.
    case "channel":
      return { channelId: change.channelId };
    case "toggle":
    case "refresh":
      return {}; // Derived from the locked target after final admission, never from client data.
    case "delete":
      return { status: -1 };
    case "status":
      if (typeof change.enabled !== "boolean") throw iamAccountDenied();
      return { status: change.enabled ? 1 : 0 };
    case "content-safety":
      return {
        contentSafetyConfig: change.config === null ? Prisma.DbNull : (change.config as Prisma.InputJsonValue),
      };
    default:
      throw iamAccountDenied();
  }
}
const mutationPolicy = Object.freeze({ timeoutMs: 30000 });
export class RelayTokenMutationRepository {
  private static instance: RelayTokenMutationRepository;
  static getInstance() {
    return (this.instance ??= new RelayTokenMutationRepository());
  }
  async tokenOwner(id: string) {
    if (!isRelayTokenResourceId(id)) throw iamAccountDenied();
    const row = await prisma.relayToken.findUnique({ where: { id }, select: { id: true, userId: true } });
    if (!row || row.id !== id || !isRelayTokenResourceId(row.userId)) throw iamAccountDenied();
    return row.userId;
  }
  snapshot(
    identity: RelayTokenAuthorityIdentity,
    kind: RelayTokenMutation["kind"],
    tx: Prisma.TransactionClient = prisma,
  ) {
    return captureRelayTokenAuthority(
      identity,
      RELAY_TOKEN_AUTHORITY_REQUIREMENTS[kind === "delete" ? "delete" : "update"],
      tx,
    );
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
  async apply<T = never>(
    targets: readonly RelayTokenMutationTarget[],
    guard: RelayTokenMutationGuard,
    change: RelayTokenMutation,
    persist: boolean,
    response?: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    const data = mutationData(change);
    const { identity, snapshot } = guard;
    const userIds = [
      ...new Set([identity.principal.subjectUserId, identity.principal.accountOwnerId, identity.userId]),
    ].sort();
    const ids = targets.map((target) => target.id).sort();
    if (
      !targets.length ||
      ((change.kind === "toggle" ||
        change.kind === "refresh" ||
        change.kind === "channel" ||
        change.kind === "update") &&
        targets.length !== 1) ||
      targets.some((row) => row.userId !== identity.userId) ||
      (change.kind === "channel" && (change.source.id !== ids[0] || change.source.userId !== identity.userId)) ||
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
            if (JSON.stringify(await this.snapshot(identity, change.kind, tx)) !== JSON.stringify(snapshot))
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
          if (change.kind === "channel") {
            await RelayChannelSelectionRepository.getInstance().lock(
              tx,
              change.configs.map((row) => row.channelId),
            );
            await RelayTokenChannelChangeRepository.getInstance().verify(change, false, tx);
            await check();
            await guard.authorize();
          }
          const fullUpdate = change.kind === "update" ? await change.prepare(tx, persist) : undefined;
          if (change.kind === "update") {
            await change.verify(tx, false);
            await check();
            await guard.authorize();
          }
          let affected = 0;
          if (persist && change.kind === "update") {
            if (!fullUpdate) throw iamAccountDenied();
            await RelayTokenUpdateRepository.getInstance().apply(tx, ids[0]!, fullUpdate);
            affected = 1;
          } else if (persist) {
            const result = await tx.relayToken.updateMany({
              where: {
                userId: identity.userId,
                OR: targets.map((row) => ({ id: row.id, status: row.status, updateTime: row.updateTime })),
              },
              data:
                change.kind === "toggle"
                  ? { status: current[0]!.status === 1 ? 0 : 1 }
                  : change.kind === "refresh"
                    ? { token: generateRelayTokenValue(), legacyToken: null }
                    : data,
            });
            if (result.count !== targets.length) throw iamAccountDenied();
            affected = result.count;
            if (change.kind === "channel") {
              await tx.relayTokenChannelConfig.deleteMany({ where: { relayTokenId: ids[0] } });
              await tx.relayTokenChannelConfig.createMany({
                data: change.configs.map((row) => ({ ...row, relayTokenId: ids[0]! })),
              });
            }
          }
          if (change.kind === "channel")
            await RelayTokenChannelChangeRepository.getInstance().verify(change, persist, tx);
          if (change.kind === "update") await change.verify(tx, persist);
          const projected = persist && response ? await response(tx) : undefined;
          // Response projection and all proof reads remain inside the rollback boundary.
          // Denial here throws out the executed UPDATE too, not merely the HTTP response.
          await check();
          await guard.authorize();
          if ((await readIamAuthorizationRevision(tx, identity.principal.accountOwnerId)) !== revision)
            throw iamAccountDenied();
          if (change.kind === "channel")
            await RelayTokenChannelChangeRepository.getInstance().verify(change, persist, tx);
          if (change.kind === "update") await change.verify(tx, persist);
          await guard.recheck(tx);
          return { total: targets.length, affected, ...(response && persist ? { response: projected } : {}) };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: mutationPolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028"].includes(error.code))
        throw new ConflictError("Token mutation context changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}

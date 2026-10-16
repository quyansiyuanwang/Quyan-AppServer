import { isDeepStrictEqual as same } from "node:util";
import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { RELAY_CHANNEL_STATUS, VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { ApiError, ConflictError, InternalServerError } from "@/util/errors";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
const mutationPolicy = Object.freeze({ timeoutMs: 30000 });
const select = { id: true, status: true, updateTime: true } as const;
export type RelayChannelStatusTarget = Prisma.RelayChannelGetPayload<{ select: typeof select }>;
export interface RelayChannelStatusGuard {
  principal: IamPrincipal;
  snapshot: PlatformManagementReadSnapshot;
  recheck: (tx?: Prisma.TransactionClient) => Promise<void>;
}
/** Status writes preserve configuration and token bindings; optional safe responses stay in this transaction. */
export class PlatformRelayChannelStatusRepository {
  private static instance: PlatformRelayChannelStatusRepository;
  static getInstance() {
    return (this.instance ??= new PlatformRelayChannelStatusRepository());
  }
  async candidates(ids: readonly string[], tx: Prisma.TransactionClient = prisma) {
    const rows = await tx.relayChannel.findMany({
      where: { id: { in: [...ids] }, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
      select,
      orderBy: { id: "asc" },
    });
    if (rows.length !== ids.length || rows.some((row) => !ids.includes(row.id))) throw iamAccountDenied();
    return rows;
  }
  async apply<T = never>(
    targets: readonly RelayChannelStatusTarget[],
    enabled: boolean | "toggle",
    guard: RelayChannelStatusGuard,
    persist: boolean,
    project?: (tx: Prisma.TransactionClient) => Promise<{ value: T; verify: () => Promise<void> }>,
  ) {
    const ids = targets.map((row) => row.id).sort();
    if (
      !ids.length ||
      new Set(ids).size !== ids.length ||
      (enabled === "toggle" ? ids.length !== 1 : typeof enabled !== "boolean")
    )
      throw iamAccountDenied();
    const nextStatus = (enabled === "toggle" ? targets[0]!.status !== RELAY_CHANNEL_STATUS.ENABLED : enabled)
      ? RELAY_CHANNEL_STATUS.ENABLED
      : RELAY_CHANNEL_STATUS.DISABLED;
    try {
      return await prisma.$transaction(
        async (tx) => {
          await assertIamAccountUserMutation(
            tx,
            {
              principal: guard.principal,
              targetUserId: guard.principal.subjectUserId,
              users: guard.snapshot.users,
              recheck: () => guard.recheck(tx),
            },
            guard.principal.subjectUserId,
          );
          await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id=${guard.snapshot.group.id} FOR UPDATE`);
          const group = await platformManagementGroupSnapshot(guard.principal, Permission.RELAY_CHANNEL_UPDATE, tx);
          if (!same(group, guard.snapshot.group)) throw iamAccountDenied();
          const revision = await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId);
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM relay_channels WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
          );
          const current = await this.candidates(ids, tx);
          if (!same(current, targets)) throw iamAccountDenied();
          await guard.recheck(tx);
          let affected = 0;
          let expected = current;
          if (persist) {
            const result = await tx.relayChannel.updateMany({
              where: { OR: targets.map(({ id, status, updateTime }) => ({ id, status, updateTime })) },
              data: { status: nextStatus },
            });
            if (result.count !== ids.length) throw iamAccountDenied();
            affected = result.count;
            const after = await this.candidates(ids, tx);
            expected = after;
            if (after.some((row) => row.status !== nextStatus)) throw iamAccountDenied();
          }
          const projection = persist && project ? await project(tx) : undefined;
          const verify = async () => {
            await projection?.verify();
            if (
              !same(expected, await this.candidates(ids, tx)) ||
              !same(
                group,
                await platformManagementGroupSnapshot(guard.principal, Permission.RELAY_CHANNEL_UPDATE, tx),
              ) ||
              (await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision
            )
              throw iamAccountDenied();
          };
          await verify();
          await guard.recheck(tx);
          await verify();
          return { total: ids.length, affected, ...(projection ? { value: projection.value } : {}) };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: mutationPolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028"].includes(error.code))
        throw new ConflictError("Channel status authorization context changed", undefined, {
          messageKey: "errors.conflict",
        });
      if (error instanceof ApiError) throw error;
      throw new InternalServerError("Channel status mutation failed", undefined, {
        messageKey: "errors.internalServerError",
      });
    }
  }
}

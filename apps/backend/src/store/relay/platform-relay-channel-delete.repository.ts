import { isDeepStrictEqual as same } from "node:util";
import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { RELAY_CHANNEL_STATUS, VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { isRelayChannelVisible } from "@/util/relay/relay-channel-visibility.util";
import { ApiError, ConflictError, InternalServerError } from "@/util/errors";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
import { relayChannelVisibilityPrincipal } from "./relay-channel-visibility-principal";
const deletionPolicy = Object.freeze({ timeoutMs: 30000 });
const select = { id: true, status: true, updateTime: true } as const;
type Target = Prisma.RelayChannelGetPayload<{ select: typeof select }>;
interface Guard {
  principal: IamPrincipal;
  snapshot: PlatformManagementReadSnapshot;
  recheck: (tx?: Prisma.TransactionClient) => Promise<void>;
}
export class PlatformRelayChannelDeleteRepository {
  private static instance: PlatformRelayChannelDeleteRepository;
  static getInstance() {
    return (this.instance ??= new PlatformRelayChannelDeleteRepository());
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
  async apply(targets: readonly Target[], guard: Guard, persist: boolean) {
    const ids = targets.map((row) => row.id).sort();
    if (!ids.length || new Set(ids).size !== ids.length) throw iamAccountDenied();
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
          if (
            !same(
              await platformManagementGroupSnapshot(guard.principal, Permission.RELAY_CHANNEL_DELETE, tx),
              guard.snapshot.group,
            )
          )
            throw iamAccountDenied();
          const revision = await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId);
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM relay_channels WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
          );
          if (!same(await this.candidates(ids, tx), targets)) throw iamAccountDenied();
          const readVisibility = async () => {
            const identity = await relayChannelVisibilityPrincipal(guard.principal, tx),
              rows = await tx.relayChannel.findMany({
                where: { id: { in: ids } },
                select: { id: true, visibilityMode: true, visibilityConfig: true },
                orderBy: { id: "asc" },
              });
            const { user, roleIds, managementBypass } = identity;
            if (
              rows.length !== ids.length ||
              rows.some(
                (row) =>
                  !managementBypass && !isRelayChannelVisible(row, { id: user.id, groupId: user.groupId, roleIds }),
              )
            )
              throw iamAccountDenied();
            return { identity, rows };
          };
          const visibility = await readVisibility();
          await guard.recheck(tx);
          let verify: () => Promise<void>;
          if (persist) {
            const deleted = await tx.relayChannel.updateMany({
              where: { OR: targets.map(({ id, status, updateTime }) => ({ id, status, updateTime })) },
              data: { status: RELAY_CHANNEL_STATUS.DELETED },
            });
            if (deleted.count !== ids.length) throw iamAccountDenied();
            // Mandatory deletion cascades use only target IDs. Never hydrate any token/credential/configuration value.
            await tx.relayToken.updateMany({ where: { channelId: { in: ids } }, data: { channelId: null } });
            await tx.relayToken.updateMany({
              where: { automaticProxyPoolChannelId: { in: ids } },
              data: { automaticProxyPoolChannelId: null, routingMode: "ordered" },
            });
            await tx.relayTokenChannelConfig.deleteMany({ where: { channelId: { in: ids } } });
            await tx.relayChannelMember.deleteMany({
              where: { OR: [{ relayChannelId: { in: ids } }, { memberChannelId: { in: ids } }] },
            });
            await tx.relayChannelChangeRequest.updateMany({
              where: { relayChannelId: { in: ids }, status: 1 },
              data: { status: -1 },
            });
            const readDeleted = () =>
              tx.relayChannel.findMany({ where: { id: { in: ids } }, select, orderBy: { id: "asc" } });
            const after = await readDeleted();
            if (
              after.length !== ids.length ||
              after.some((row, i) => row.id !== ids[i] || row.status !== RELAY_CHANNEL_STATUS.DELETED)
            )
              throw iamAccountDenied();
            verify = async () => {
              if (
                !same(after, await readDeleted()) ||
                (await tx.relayToken.count({
                  where: { OR: [{ channelId: { in: ids } }, { automaticProxyPoolChannelId: { in: ids } }] },
                })) ||
                (await tx.relayTokenChannelConfig.count({ where: { channelId: { in: ids } } })) ||
                (await tx.relayChannelMember.count({
                  where: { OR: [{ relayChannelId: { in: ids } }, { memberChannelId: { in: ids } }] },
                })) ||
                (await tx.relayChannelChangeRequest.count({ where: { relayChannelId: { in: ids }, status: 1 } }))
              )
                throw iamAccountDenied();
            };
          } else
            verify = async () => {
              if (!same(targets, await this.candidates(ids, tx))) throw iamAccountDenied();
            };
          const verifyContext = async () => {
            await verify();
            if (
              !same(visibility, await readVisibility()) ||
              (await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision
            )
              throw iamAccountDenied();
          };
          await verifyContext();
          await guard.recheck(tx);
          await verifyContext();
          return { total: ids.length, affected: persist ? ids.length : 0 };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: deletionPolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028"].includes(error.code))
        throw new ConflictError("Channel deletion context changed", undefined, { messageKey: "errors.conflict" });
      if (error instanceof ApiError) throw error;
      throw new InternalServerError("Channel deletion failed", undefined, { messageKey: "errors.internalServerError" });
    }
  }
}

import { isDeepStrictEqual } from "node:util";
import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { BadRequestError, ConflictError } from "@/util/errors";
import { isRelayChannelVisible } from "@/util/relay/relay-channel-visibility.util";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
import { relayChannelVisibilityPrincipal } from "./relay-channel-visibility-principal";
const admissionPolicy = Object.freeze({ timeoutMs: 30000 });
const select = { id: true, status: true, updateTime: true, channelType: true } as const;
type Target = Prisma.RelayChannelGetPayload<{ select: typeof select }>;
interface Guard {
  principal: IamPrincipal;
  snapshot: PlatformManagementReadSnapshot;
  recheck: (tx?: Prisma.TransactionClient) => Promise<void>;
}
/** Locks stabilize admission, NOT the Redis effect. No SQL write or credential/configuration hydration. */
export class RelayChannelHealthClearRepository {
  private static instance: RelayChannelHealthClearRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelHealthClearRepository());
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
  async withAdmission(targets: readonly Target[], guard: Guard, effect?: () => Promise<void>) {
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
            !isDeepStrictEqual(
              await platformManagementGroupSnapshot(guard.principal, Permission.RELAY_CHANNEL_UPDATE, tx),
              guard.snapshot.group,
            )
          )
            throw iamAccountDenied();
          const revision = await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId);
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM relay_channels WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
          );
          if (!isDeepStrictEqual(await this.candidates(ids, tx), targets)) throw iamAccountDenied();
          if (targets.some((row) => row.channelType !== "standalone"))
            throw new BadRequestError("Health statistics only exist for standalone channels", undefined, {
              messageKey: "relayChannel.healthStatsStandaloneOnly",
            });
          const readVisibility = async () => {
            const identity = await relayChannelVisibilityPrincipal(guard.principal, tx);
            const rows = await tx.relayChannel.findMany({
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
          const recheck = async () => {
            if (
              !isDeepStrictEqual(await this.candidates(ids, tx), targets) ||
              !isDeepStrictEqual(await readVisibility(), visibility) ||
              (await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision
            )
              throw iamAccountDenied();
            await guard.recheck(tx);
          };
          await recheck();
          // This is the admission boundary for an irreversible cross-store effect. Never retry this callback.
          if (effect) await effect();
          await recheck();
          return { total: ids.length, affected: effect ? ids.length : 0 };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: admissionPolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028"].includes(error.code))
        throw new ConflictError("Channel health clear admission changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}

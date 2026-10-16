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
import type { UpdateRelayChannelHealthConfigRequest } from "@/api/dto/relay/relay-channel.dto";
const mutationPolicy = Object.freeze({ timeoutMs: 30000 });
const metadataSelect = { id: true, status: true, updateTime: true, channelType: true } as const;
const configSelect = { ...metadataSelect, routingConfig: true, visibilityMode: true, visibilityConfig: true } as const;
type Target = Prisma.RelayChannelGetPayload<{ select: typeof metadataSelect }>;
type Source = Prisma.RelayChannelGetPayload<{ select: typeof configSelect }>;
interface Guard {
  principal: IamPrincipal;
  snapshot: PlatformManagementReadSnapshot;
  recheck: (tx?: Prisma.TransactionClient) => Promise<void>;
}
const same = isDeepStrictEqual;
/** Admit every target before hydrating configuration; all writes and response projection share the final guard. */
export class RelayChannelHealthConfigRepository {
  private static instance: RelayChannelHealthConfigRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelHealthConfigRepository());
  }
  async candidates(ids: readonly string[], tx: Prisma.TransactionClient = prisma) {
    const rows = await tx.relayChannel.findMany({
      where: { id: { in: [...ids] }, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
      select: metadataSelect,
      orderBy: { id: "asc" },
    });
    if (rows.length !== ids.length || rows.some((row) => !ids.includes(row.id))) throw iamAccountDenied();
    return rows;
  }
  async apply<T>(
    targets: readonly Target[],
    data: UpdateRelayChannelHealthConfigRequest,
    guard: Guard,
    persist: boolean,
    project?: (row: Pick<Source, "id" | "routingConfig">) => Promise<T>,
  ) {
    const ids = targets.map((row) => row.id).sort();
    if (!ids.length || new Set(ids).size !== ids.length || (project && ids.length !== 1)) throw iamAccountDenied();
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
              await platformManagementGroupSnapshot(guard.principal, Permission.RELAY_CHANNEL_UPDATE, tx),
              guard.snapshot.group,
            )
          )
            throw iamAccountDenied();
          const revision = await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId);
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM relay_channels WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
          );
          if (!same(await this.candidates(ids, tx), targets)) throw iamAccountDenied();
          if (targets.some((row) => row.channelType !== "standalone"))
            throw new BadRequestError("Health tracking can only be configured for standalone channels", undefined, {
              messageKey: "relayChannel.healthTrackingStandaloneOnly",
            });
          await guard.recheck(tx);
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
          let affected = 0;
          let projection: T | undefined;
          if (persist) {
            const sources = await tx.relayChannel.findMany({
              where: { id: { in: ids } },
              select: configSelect,
              orderBy: { id: "asc" },
            });
            if (
              !same(
                sources.map(({ id, status, updateTime, channelType }) => ({ id, status, updateTime, channelType })),
                targets,
              )
            )
              throw iamAccountDenied();
            const expected = [];
            for (const row of sources) {
              if (
                row.routingConfig !== null &&
                (typeof row.routingConfig !== "object" || Array.isArray(row.routingConfig))
              )
                throw iamAccountDenied();
              const routingConfig = {
                ...((row.routingConfig as Prisma.JsonObject | null) ?? {}),
                healthTrackingMode: data.healthTrackingMode,
                manualAvailability: data.healthTrackingMode === "manual" ? Number(data.manualAvailability) : null,
                manualLatencyMs: data.healthTrackingMode === "manual" ? Number(data.manualLatencyMs) : null,
              };
              const result = await tx.relayChannel.updateMany({
                where: { id: row.id, status: row.status, updateTime: row.updateTime, channelType: row.channelType },
                data: { routingConfig: routingConfig as Prisma.InputJsonValue },
              });
              if (result.count !== 1) throw iamAccountDenied();
              affected += result.count;
              expected.push({ ...row, routingConfig });
            }
            // Capture timestamps written by Prisma; payload comparison also detects changes that preserve timestamps.
            const updated = await tx.relayChannel.findMany({
              where: { id: { in: ids } },
              select: configSelect,
              orderBy: { id: "asc" },
            });
            if (
              !same(
                updated.map(({ updateTime: _time, ...row }) => row),
                expected.map(({ updateTime: _time, ...row }) => row),
              )
            )
              throw iamAccountDenied();
            if (project) projection = await project(updated[0]!);
            if (
              !same(
                updated,
                await tx.relayChannel.findMany({
                  where: { id: { in: ids } },
                  select: configSelect,
                  orderBy: { id: "asc" },
                }),
              )
            )
              throw iamAccountDenied();
          }
          if (
            !same(visibility, await readVisibility()) ||
            (await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision
          )
            throw iamAccountDenied();
          await guard.recheck(tx);
          return { total: ids.length, affected, projection };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: mutationPolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028"].includes(error.code))
        throw new ConflictError("Channel health configuration authorization context changed", undefined, {
          messageKey: "errors.conflict",
        });
      throw error;
    }
  }
}

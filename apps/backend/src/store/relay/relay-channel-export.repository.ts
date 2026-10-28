import { RELAY_CHANNEL_STATUS, VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { isDeepStrictEqual as same } from "node:util";
import type { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import type { ExportRelayChannelsRequest, RelayChannelExportResponse } from "@/api/dto/relay/relay-channel.dto";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { RELAY_CAPABILITY_RESOLUTION_LIMITS } from "@/constant/relay-capability";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { readIamPersonalCollection } from "../users/iam-personal-collection-read";
import { relayChannelVisibilityPrincipal } from "./relay-channel-visibility-principal";
import { isRelayChannelVisible } from "@/util/relay/relay-channel-visibility.util";
import { resolveEffectiveRelayPoolMembers } from "@/services/relay/utils/relay-pool-members.util";
import { projectRelayChannelExport } from "@/services/relay/relay-channel-export-projection";
const metadataSelect = { id: true, status: true, providerServiceEnabled: true, updateTime: true } as const;
/** No URL, credential, provider identity or rich relation can enter the export read. */
export const relayChannelExportSelect = {
  ...metadataSelect,
  name: true,
  channelType: true,
  routingStrategy: true,
  routingConfig: true,
  visibilityMode: true,
  visibilityConfig: true,
  pooledParentId: true,
  pooledPriority: true,
  pooledWeight: true,
  pooledMemberEnabled: true,
  useProxy: true,
  multiplier: true,
  allowedFormats: true,
  allowedModels: true,
  addUserIdentifier: true,
  inputTokensIncludeCacheRead: true,
  modelMapping: true,
  timePeriodMultipliers: true,
  contextLengthMultipliers: true,
  createTime: true,
} as const satisfies Prisma.RelayChannelSelect;
const topologySelect = {
  id: true,
  channelType: true,
  pooledParentId: true,
  pooledPriority: true,
  pooledWeight: true,
  pooledMemberEnabled: true,
  poolMembers: {
    select: { memberChannelId: true, priority: true, weight: true, enabled: true },
    orderBy: { memberChannelId: "asc" },
    take: RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes + 1,
  },
  pooledChildren: {
    where: { status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
    select: { id: true, channelType: true, pooledPriority: true, pooledWeight: true, pooledMemberEnabled: true },
    orderBy: { id: "asc" },
    take: RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes + 1,
  },
} as const satisfies Prisma.RelayChannelSelect;
export class RelayChannelExportRepository {
  private static instance: RelayChannelExportRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelExportRepository());
  }
  async read(
    principal: IamPrincipal,
    options: ExportRelayChannelsRequest,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
    hydrate: boolean,
  ): Promise<RelayChannelExportResponse | undefined> {
    return readIamPersonalCollection(principal, decide, recheck, async (tx, checkedDecide) => {
      const limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
      const scan = async (admit: boolean) => {
        const rows: Prisma.RelayChannelGetPayload<{ select: typeof metadataSelect }>[] = [];
        const allowed = new Set<string>();
        let after: string | undefined;
        for (;;) {
          await recheck();
          const batch = await tx.relayChannel.findMany({
            where: { status: { in: VISIBLE_RELAY_CHANNEL_STATUSES }, ...(after ? { id: { gt: after } } : {}) },
            select: metadataSelect,
            orderBy: { id: "asc" },
            take: limit,
          });
          if (rows.length + batch.length > RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes) throw iamAccountDenied();
          rows.push(...batch);
          if (admit) {
            const outcomes = await checkedDecide(batch.map((row) => platformRelayChannelArn(row.id)));
            batch.forEach((row, index) => {
              if (outcomes[index] === "Allow") allowed.add(row.id);
            });
          }
          if (batch.length < limit) break;
          after = batch[batch.length - 1]!.id;
        }
        return { rows, allowed };
      };
      const initial = await scan(true),
        byId = new Map(initial.rows.map((row) => [row.id, row]));
      const active = (id: string) => {
        const row = byId.get(id);
        return (
          row &&
          (options.includeDisabled || (row.status === RELAY_CHANNEL_STATUS.ENABLED && row.providerServiceEnabled))
        );
      };
      const roots = options.ids?.length
        ? [...new Set(options.ids)]
        : initial.rows.filter((row) => initial.allowed.has(row.id) && active(row.id)).map((row) => row.id);
      if (roots.some((id) => !initial.allowed.has(id) || !active(id))) throw iamAccountDenied();
      // Shadow only observes metadata admission; it never reads the configuration graph or export payload.
      if (!hydrate) return undefined;
      const identity = await relayChannelVisibilityPrincipal(principal, tx),
        visibility = new Map<string, unknown>();
      const graph = new Map<string, Prisma.RelayChannelGetPayload<{ select: typeof topologySelect }>>();
      const eligibleRoots: string[] = [];
      for (const id of roots) {
        const row = await tx.relayChannel.findUnique({
          where: { id },
          select: { id: true, visibilityMode: true, visibilityConfig: true },
        });
        if (!row || row.id !== id) throw iamAccountDenied();
        const visible =
          identity.managementBypass ||
          isRelayChannelVisible(row, {
            id: identity.user.id,
            groupId: identity.user.groupId,
            roleIds: identity.roleIds,
          });
        if (visible) eligibleRoots.push(id);
        else if (options.ids?.length) throw iamAccountDenied();
      }
      const queue = [...eligibleRoots],
        seen = new Set<string>();
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const id = queue[cursor]!;
        if (seen.has(id)) continue;
        if (!initial.allowed.has(id) || !byId.has(id) || seen.size >= RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes)
          throw iamAccountDenied();
        seen.add(id);
        await recheck();
        const visible = await tx.relayChannel.findUnique({
          where: { id },
          select: { id: true, visibilityMode: true, visibilityConfig: true },
        });
        if (
          !visible ||
          visible.id !== id ||
          (!identity.managementBypass &&
            !isRelayChannelVisible(visible, {
              id: identity.user.id,
              groupId: identity.user.groupId,
              roleIds: identity.roleIds,
            }))
        )
          throw iamAccountDenied();
        visibility.set(id, visible);
        const row = await tx.relayChannel.findUnique({ where: { id }, select: topologySelect });
        if (
          !row ||
          row.id !== id ||
          row.poolMembers.length > RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes ||
          row.pooledChildren.length > RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes
        )
          throw iamAccountDenied();
        graph.set(id, row);
        const dependencies = resolveEffectiveRelayPoolMembers(row).map((member) => member.memberChannelId);
        if (row.pooledParentId) dependencies.push(row.pooledParentId);
        if (queue.length + dependencies.length > RELAY_CAPABILITY_RESOLUTION_LIMITS.traversalVisits)
          throw iamAccountDenied();
        queue.push(...dependencies);
      }
      const ids = [...seen],
        sources: Prisma.RelayChannelGetPayload<{ select: typeof relayChannelExportSelect }>[] = [];
      for (let offset = 0; offset < ids.length; offset += limit) {
        await recheck();
        const batch = ids.slice(offset, offset + limit),
          found = await tx.relayChannel.findMany({
            where: { id: { in: batch } },
            select: relayChannelExportSelect,
            orderBy: { id: "asc" },
          });
        if (
          found.length !== batch.length ||
          found.some((row) => row.updateTime.getTime() !== byId.get(row.id)!.updateTime.getTime())
        )
          throw iamAccountDenied();
        sources.push(...found);
      }
      const sourceById = new Map(sources.map((row) => [row.id, row]));
      const result = {
        channels: ids.map((id) =>
          projectRelayChannelExport(
            sourceById.get(id)!,
            resolveEffectiveRelayPoolMembers(graph.get(id)!).map((member) => ({
              memberChannelId: member.memberChannelId,
              priority: member.priority,
              weight: Number(member.weight),
              enabled: member.enabled,
            })),
          ),
        ),
      };
      if (
        !same(initial.rows, (await scan(false)).rows) ||
        !same(identity, await relayChannelVisibilityPrincipal(principal, tx))
      )
        throw iamAccountDenied();
      for (const id of ids) {
        if (
          !same(
            visibility.get(id),
            await tx.relayChannel.findUnique({
              where: { id },
              select: { id: true, visibilityMode: true, visibilityConfig: true },
            }),
          ) ||
          !same(graph.get(id), await tx.relayChannel.findUnique({ where: { id }, select: topologySelect })) ||
          !same(
            sourceById.get(id),
            await tx.relayChannel.findUnique({ where: { id }, select: relayChannelExportSelect }),
          )
        )
          throw iamAccountDenied();
      }
      return result;
    });
  }
}

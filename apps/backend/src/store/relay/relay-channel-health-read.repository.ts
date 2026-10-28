import type { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { isRelayChannelVisible } from "@/util/relay/relay-channel-visibility.util";
import { readIamPersonalCollection } from "../users/iam-personal-collection-read";
import { iamAccountDenied } from "../users/iam-account-principal";
import { relayChannelVisibilityPrincipal } from "./relay-channel-visibility-principal";
import { resolveEffectiveRelayPoolMembers } from "@/services/relay/utils/relay-pool-members.util";
const metadataSelect = { id: true, status: true, updateTime: true, channelType: true } as const;
/** Health configuration only: no credentials, URLs, model catalog, provider, user or price records. */
export const relayChannelHealthReadSelect = {
  ...metadataSelect,
  name: true,
  providerServiceEnabled: true,
  routingConfig: true,
  multiplier: true,
  timePeriodMultipliers: true,
  pooledParentId: true,
  pooledPriority: true,
  pooledWeight: true,
  pooledMemberEnabled: true,
  poolMembers: {
    select: { memberChannelId: true, priority: true, weight: true, enabled: true },
    orderBy: { memberChannelId: "asc" },
  },
} as const satisfies Prisma.RelayChannelSelect;
export type RelayChannelHealthReadSource = Prisma.RelayChannelGetPayload<{
  select: typeof relayChannelHealthReadSelect;
}>;
export type RelayChannelHealthReadOptions = { kind: "overview" | "single" | "automatic-pools"; id?: string };
export interface RelayChannelHealthReadSnapshot {
  targets: RelayChannelHealthReadSource[];
  sources: ReadonlyMap<string, RelayChannelHealthReadSource>;
  members: (
    source: RelayChannelHealthReadSource,
  ) => ReturnType<typeof resolveEffectiveRelayPoolMembers<RelayChannelHealthReadSource>>;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export class RelayChannelHealthReadRepository {
  private static instance: RelayChannelHealthReadRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelHealthReadRepository());
  }
  async read<T>(
    principal: IamPrincipal,
    options: RelayChannelHealthReadOptions,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
    project?: (snapshot: RelayChannelHealthReadSnapshot) => Promise<T>,
  ): Promise<T | undefined> {
    if (
      !["overview", "single", "automatic-pools"].includes(options.kind) ||
      (options.kind === "single" ? !/^[A-Za-z0-9_-]{1,128}$/.test(options.id ?? "") : options.id !== undefined)
    )
      throw iamAccountDenied();
    return readIamPersonalCollection(principal, decide, recheck, async (tx, checkedDecide) => {
      const limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
      const scan = async (authorize: boolean) => {
        const rows: Prisma.RelayChannelGetPayload<{ select: typeof metadataSelect }>[] = [],
          admitted: string[] = [];
        let after: string | undefined;
        for (;;) {
          await recheck();
          const batch = await tx.relayChannel.findMany({
            where: { status: { in: VISIBLE_RELAY_CHANNEL_STATUSES }, ...(after ? { id: { gt: after } } : {}) },
            select: metadataSelect,
            orderBy: { id: "asc" },
            take: limit,
          });
          if (!batch.length) break;
          if (authorize) {
            const outcomes = await checkedDecide(batch.map((row) => platformRelayChannelArn(row.id)));
            batch.forEach((row, i) => {
              if (outcomes[i] === "Allow") admitted.push(row.id);
            });
          }
          rows.push(...batch);
          after = batch[batch.length - 1]!.id;
          if (batch.length < limit) break;
        }
        return { rows, admitted };
      };
      const initial = await scan(true);
      if (options.kind === "single" && !initial.admitted.includes(options.id!)) throw iamAccountDenied();
      if (!project) return undefined; // Shadow observation must never read health payloads or Redis.
      const readVisibility = async () => {
        const identity = await relayChannelVisibilityPrincipal(principal, tx),
          rows = [];
        for (let offset = 0; offset < initial.admitted.length; offset += limit) {
          const ids = initial.admitted.slice(offset, offset + limit),
            batch = await tx.relayChannel.findMany({
              where: { id: { in: ids }, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
              select: { id: true, visibilityMode: true, visibilityConfig: true },
              orderBy: { id: "asc" },
            });
          if (batch.length !== ids.length) throw iamAccountDenied();
          rows.push(...batch);
        }
        const { user, roleIds, managementBypass } = identity;
        return {
          identity,
          rows,
          visibleIds: rows
            .filter(
              (row) => managementBypass || isRelayChannelVisible(row, { id: user.id, groupId: user.groupId, roleIds }),
            )
            .map((row) => row.id),
        };
      };
      const visibility = await readVisibility();
      if (options.kind === "single" && !visibility.visibleIds.includes(options.id!)) throw iamAccountDenied();
      const selected = initial.rows.filter(
        (row) =>
          visibility.visibleIds.includes(row.id) &&
          (options.kind === "single"
            ? row.id === options.id
            : row.channelType === (options.kind === "overview" ? "standalone" : "automatic-proxy-pool")),
      );
      const metadataById = new Map(initial.rows.map((row) => [row.id, row])),
        visibleIds = new Set(visibility.visibleIds);
      const readSources = async () => {
        const load = async (ids: readonly string[]) => {
          const rows: RelayChannelHealthReadSource[] = [];
          for (let offset = 0; offset < ids.length; offset += limit) {
            await recheck();
            const batchIds = ids.slice(offset, offset + limit);
            const batch = await tx.relayChannel.findMany({
              where: { id: { in: [...batchIds] }, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
              select: relayChannelHealthReadSelect,
              orderBy: { id: "asc" },
            });
            if (
              batch.length !== batchIds.length ||
              batch.some((row) => {
                const old = metadataById.get(row.id);
                return (
                  !old ||
                  !batchIds.includes(row.id) ||
                  old.status !== row.status ||
                  old.channelType !== row.channelType ||
                  old.updateTime.getTime() !== row.updateTime.getTime()
                );
              })
            )
              throw iamAccountDenied();
            rows.push(...batch);
          }
          return rows;
        };
        // Read only returned roots and their admitted direct ranking members, not unrelated allowed configuration.
        const roots = await load(selected.map((row) => row.id)),
          rootIds = new Set(roots.map((row) => row.id));
        const relatedIds = [
          ...new Set(
            roots
              .filter((row) => row.channelType === "automatic-proxy-pool")
              .flatMap((row) => row.poolMembers.map((member) => member.memberChannelId)),
          ),
        ]
          .filter((id) => visibleIds.has(id) && !rootIds.has(id))
          .sort();
        return [...roots, ...(await load(relatedIds))].sort((a, b) => a.id.localeCompare(b.id));
      };
      const rows = await readSources(),
        sources = new Map(rows.map((row) => [row.id, row])),
        children = new Map<string, RelayChannelHealthReadSource[]>();
      for (const row of rows)
        if (row.pooledParentId) {
          const group = children.get(row.pooledParentId) ?? [];
          group.push(row);
          children.set(row.pooledParentId, group);
        }
      const result = await project({
        targets: selected.map((row) => {
          const source = sources.get(row.id);
          if (!source) throw iamAccountDenied();
          return source;
        }),
        sources,
        members: (row) =>
          resolveEffectiveRelayPoolMembers<RelayChannelHealthReadSource>({
            ...row,
            pooledChildren: children.get(row.id) ?? [],
          })
            .filter((member) => sources.has(member.memberChannelId))
            .map((member) => ({ ...member, memberChannel: sources.get(member.memberChannelId)! })),
      });
      if (
        !same(initial.rows, (await scan(false)).rows) ||
        !same(visibility, await readVisibility()) ||
        !same(rows, await readSources())
      )
        throw iamAccountDenied();
      return result;
    });
  }
}

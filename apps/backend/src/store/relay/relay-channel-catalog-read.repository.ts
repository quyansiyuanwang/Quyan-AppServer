import { isDeepStrictEqual as same } from "node:util";
import type { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { RELAY_CAPABILITY_RESOLUTION_LIMITS } from "@/constant/relay-capability";
import { RELAY_CHANNEL_STATUS } from "@/constant/relay-channel";
import { DEFAULT_RELAY_CONFIG } from "@/constant/relay-config";
import { relayChannelSelectionArn } from "@/iam/resources/relay-channel-selection-resources";
import { isRelayChannelVisible } from "@/util/relay/relay-channel-visibility.util";
import type { RelayPoolResolverContext, RelayCapabilityGraphNode } from "@/services/relay/relay-pool-resolver.service";
import { resolveEffectiveRelayPoolMembers } from "@/services/relay/utils/relay-pool-members.util";
import { readIamPersonalCollection } from "../users/iam-personal-collection-read";
import { iamAccountDenied } from "../users/iam-account-principal";
import { relayChannelVisibilityPrincipal } from "./relay-channel-visibility-principal";
const metadataSelect = { id: true, status: true, providerServiceEnabled: true, updateTime: true } as const;
/** Consumer projection only: never URLs, credentials, provider identities, or complete configuration. */
export const relayCatalogSourceSelect = {
  ...metadataSelect,
  name: true,
  channelType: true,
  allowedFormats: true,
  allowedModels: true,
  modelMapping: true,
  routingConfig: true,
  multiplier: true,
  timePeriodMultipliers: true,
  contextLengthMultipliers: true,
  pooledParentId: true,
  pooledPriority: true,
  pooledWeight: true,
  pooledMemberEnabled: true,
  poolMembers: {
    select: { memberChannelId: true, priority: true, weight: true, enabled: true },
    orderBy: { memberChannelId: "asc" },
    take: RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes + 1,
  },
} as const satisfies Prisma.RelayChannelSelect;
export type RelayCatalogSource = Prisma.RelayChannelGetPayload<{ select: typeof relayCatalogSourceSelect }>;
export type RelayCatalogSnapshot = {
  sources: readonly RelayCatalogSource[];
  context: RelayPoolResolverContext;
  poolVisibility: "anonymous-range" | "hidden";
};
export class RelayChannelCatalogReadRepository {
  private static instance: RelayChannelCatalogReadRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelCatalogReadRepository());
  }
  async read<T>(
    principal: IamPrincipal,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
    project?: (snapshot: RelayCatalogSnapshot) => Promise<T>,
  ): Promise<T | undefined> {
    return readIamPersonalCollection(principal, decide, recheck, async (tx, checkedDecide) => {
      const limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
      const scan = async (authorize: boolean) => {
        const rows: Prisma.RelayChannelGetPayload<{ select: typeof metadataSelect }>[] = [],
          admitted: string[] = [];
        let after: string | undefined;
        for (;;) {
          await recheck();
          const batch = await tx.relayChannel.findMany({
            where: {
              status: RELAY_CHANNEL_STATUS.ENABLED,
              providerServiceEnabled: true,
              ...(after ? { id: { gt: after } } : {}),
            },
            select: metadataSelect,
            orderBy: { id: "asc" },
            take: limit,
          });
          if (!batch.length) break;
          if (rows.length + batch.length > RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes) throw iamAccountDenied();
          if (authorize) {
            const outcomes = await checkedDecide(
              batch.map((row) => relayChannelSelectionArn(principal.accountOwnerId, row.id)),
            );
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
      // Shadow observes admission only; it does not hydrate any labels, model graph, or prices.
      if (!project) return undefined;
      const readVisibility = async () => {
        const identity = await relayChannelVisibilityPrincipal(principal, tx),
          rows = [];
        for (let offset = 0; offset < initial.admitted.length; offset += limit) {
          const ids = initial.admitted.slice(offset, offset + limit);
          const batch = await tx.relayChannel.findMany({
            where: { id: { in: ids } },
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
          ids: rows
            .filter(
              (row) =>
                row.visibilityMode !== "hidden" &&
                (managementBypass || isRelayChannelVisible(row, { id: user.id, groupId: user.groupId, roleIds })),
            )
            .map((row) => row.id),
        };
      };
      const visibility = await readVisibility();
      const readSources = async () => {
        const rows: RelayCatalogSource[] = [];
        for (let offset = 0; offset < visibility.ids.length; offset += limit) {
          await recheck();
          const ids = visibility.ids.slice(offset, offset + limit);
          const batch = await tx.relayChannel.findMany({
            where: { id: { in: ids } },
            select: relayCatalogSourceSelect,
            orderBy: { id: "asc" },
          });
          if (
            batch.length !== ids.length ||
            batch.some(
              (row) =>
                !initial.rows.some((old) =>
                  same(old, {
                    id: row.id,
                    status: row.status,
                    providerServiceEnabled: row.providerServiceEnabled,
                    updateTime: row.updateTime,
                  }),
                ),
            )
          )
            throw iamAccountDenied();
          rows.push(...batch);
        }
        return rows;
      };
      const sources = await readSources();
      if (sources.some((row) => row.poolMembers.length > RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes))
        throw iamAccountDenied();
      const byId = new Map(sources.map((row) => [row.id, row]));
      const children = new Map<string, RelayCatalogSource[]>();
      for (const row of sources)
        if (row.pooledParentId) {
          const list = children.get(row.pooledParentId) ?? [];
          list.push(row);
          children.set(row.pooledParentId, list);
        }
      const graph = new Map<string, RelayCapabilityGraphNode>();
      for (const row of sources)
        graph.set(row.id, {
          ...row,
          poolMembers: resolveEffectiveRelayPoolMembers<RelayCatalogSource>({
            ...row,
            pooledChildren: children.get(row.id) ?? [],
          }).filter((member) => byId.has(member.memberChannelId)),
        });
      if (
        [...graph.values()].reduce((count, row) => count + row.poolMembers.length, 0) >
        RELAY_CAPABILITY_RESOLUTION_LIMITS.traversalVisits
      )
        throw iamAccountDenied();
      const readModels = () =>
        tx.modelPricing.findMany({
          where: { status: 1 },
          select: { id: true, status: true, updateTime: true, model: true, provider: true, supportedFormats: true },
          orderBy: { id: "asc" },
        });
      const readConfig = () =>
        tx.relayConfig.findFirst({
          where: { status: 1 },
          orderBy: [{ updateTime: "desc" }, { id: "desc" }],
          select: { id: true, status: true, updateTime: true, apiCatalogPoolVisibility: true },
        });
      const models = sources.length ? await readModels() : [],
        config = sources.length ? await readConfig() : null;
      const poolVisibility = config?.apiCatalogPoolVisibility ?? DEFAULT_RELAY_CONFIG.apiCatalogPoolVisibility;
      if (poolVisibility !== "anonymous-range" && poolVisibility !== "hidden") throw iamAccountDenied();
      const result = await project({ sources, context: { graph, modelCatalog: models }, poolVisibility });
      if (
        !same(initial.rows, (await scan(false)).rows) ||
        !same(visibility, await readVisibility()) ||
        !same(sources, await readSources()) ||
        (sources.length && (!same(models, await readModels()) || !same(config, await readConfig())))
      )
        throw iamAccountDenied();
      return result;
    });
  }
}

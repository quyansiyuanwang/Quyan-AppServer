import { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { RELAY_CHANNEL_STATUS, VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { isRelayChannelVisible } from "@/util/relay/relay-channel-visibility.util";
import type { RelayPoolResolverContext, RelayCapabilityGraphNode } from "@/services/relay/relay-pool-resolver.service";
import type {
  RelayChannelConfigurationSource,
  RelayChannelCredentialPresence,
} from "@/services/relay/relay-channel-configuration-projection";
import { resolveEffectiveRelayPoolMembers } from "@/services/relay/utils/relay-pool-members.util";
import { readIamPersonalCollection } from "../users/iam-personal-collection-read";
import { iamAccountDenied } from "../users/iam-account-principal";
import { relayChannelVisibilityPrincipal } from "./relay-channel-visibility-principal";

const metadataSelect = {
  id: true,
  status: true,
  providerServiceEnabled: true,
  createTime: true,
  updateTime: true,
} as const;
const graphSelect = {
  ...metadataSelect,
  name: true,
  channelType: true,
  allowedFormats: true,
  allowedModels: true,
  modelMapping: true,
  routingConfig: true,
  pooledParentId: true,
  pooledPriority: true,
  pooledWeight: true,
  pooledMemberEnabled: true,
  poolMembers: {
    select: { memberChannelId: true, priority: true, weight: true, enabled: true },
    orderBy: { memberChannelId: "asc" },
  },
} as const satisfies Prisma.RelayChannelSelect;
/** No credential columns or rich user/channel includes, even for an admitted configuration. */
export const relayChannelConfigurationReadSelect = {
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
  openaiUpstreamUrl: true,
  anthropicUpstreamUrl: true,
  geminiUpstreamUrl: true,
  useProxy: true,
  multiplier: true,
  allowedFormats: true,
  allowedModels: true,
  addUserIdentifier: true,
  inputTokensIncludeCacheRead: true,
  modelMapping: true,
  timePeriodMultipliers: true,
  contextLengthMultipliers: true,
  submissionStatus: true,
  submittedByUserId: true,
  reviewedAt: true,
  reviewReason: true,
  submittedBy: { select: { username: true } },
  providers: {
    where: { status: 1 },
    orderBy: [{ createTime: "asc" }, { id: "asc" }],
    select: {
      id: true,
      userId: true,
      commissionPercent: true,
      settlementMode: true,
      settlementIntervalDays: true,
      settlementTime: true,
      nextSettlementAt: true,
      user: { select: { username: true } },
    },
  },
} as const satisfies Prisma.RelayChannelSelect;
type Metadata = Prisma.RelayChannelGetPayload<{ select: typeof metadataSelect }>;
type GraphSource = Prisma.RelayChannelGetPayload<{ select: typeof graphSelect }>;
export type RelayChannelConfigurationReadOptions = { id?: string; includeDisabled: boolean };
export type RelayChannelConfigurationReadSnapshot = {
  records: { source: RelayChannelConfigurationSource; presence: RelayChannelCredentialPresence }[];
  context: RelayPoolResolverContext;
};
export interface RelayChannelConfigurationReadStore {
  read<T>(
    principal: IamPrincipal,
    options: RelayChannelConfigurationReadOptions,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
    project?: (snapshot: RelayChannelConfigurationReadSnapshot) => Promise<T>,
  ): Promise<T | undefined>;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const enabled = (row: Metadata) => row.status === RELAY_CHANNEL_STATUS.ENABLED && row.providerServiceEnabled;
/** Convert only verified SQL booleans; malformed/raw credential values must never be accepted. */
function sqlBoolean(value: unknown): boolean {
  if (value === true || value === 1 || value === 1n) return true;
  if (value === false || value === 0 || value === 0n) return false;
  throw iamAccountDenied();
}
export class RelayChannelConfigurationReadRepository implements RelayChannelConfigurationReadStore {
  private static instance: RelayChannelConfigurationReadRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelConfigurationReadRepository());
  }
  async read<T>(
    principal: IamPrincipal,
    options: RelayChannelConfigurationReadOptions,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
    project?: (snapshot: RelayChannelConfigurationReadSnapshot) => Promise<T>,
  ): Promise<T | undefined> {
    if (
      typeof options.includeDisabled !== "boolean" ||
      (options.id !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(options.id))
    )
      throw iamAccountDenied();
    return readIamPersonalCollection(principal, decide, recheck, async (tx, checkedDecide) => {
      const limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
      const scan = async (authorize: boolean) => {
        const rows: Metadata[] = [],
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
      if (options.id && !initial.admitted.includes(options.id)) throw iamAccountDenied();
      // Shadow mode performs metadata/decision observation only, never configuration or credential reads.
      if (!project) return undefined;
      const readVisibility = async () => {
        const identity = await relayChannelVisibilityPrincipal(principal, tx),
          rows = [];
        for (let offset = 0; offset < initial.admitted.length; offset += limit) {
          const ids = initial.admitted.slice(offset, offset + limit);
          const batch = await tx.relayChannel.findMany({
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
      const visibility = await readVisibility(),
        visible = new Set(visibility.visibleIds);
      if (options.id && !visible.has(options.id)) throw iamAccountDenied();
      const targets = initial.rows.filter(
        (row) => visible.has(row.id) && (options.id ? row.id === options.id : options.includeDisabled || enabled(row)),
      );
      const readGraph = async () => {
        const rows: GraphSource[] = [];
        for (let offset = 0; offset < visibility.visibleIds.length; offset += limit) {
          await recheck();
          const ids = visibility.visibleIds.slice(offset, offset + limit);
          const batch = await tx.relayChannel.findMany({
            where: { id: { in: ids }, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
            select: graphSelect,
            orderBy: { id: "asc" },
          });
          if (
            batch.length !== ids.length ||
            batch.some(
              (row) =>
                !initial.rows.some(
                  (old) =>
                    old.id === row.id &&
                    same(old, {
                      id: row.id,
                      status: row.status,
                      providerServiceEnabled: row.providerServiceEnabled,
                      createTime: row.createTime,
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
      const sources = await readGraph(),
        byId = new Map(sources.map((row) => [row.id, row]));
      const children = new Map<string, GraphSource[]>();
      for (const row of sources)
        if (row.pooledParentId) {
          const siblings = children.get(row.pooledParentId) ?? [];
          siblings.push(row);
          children.set(row.pooledParentId, siblings);
        }
      const effectiveMembers = (row: GraphSource) =>
        resolveEffectiveRelayPoolMembers<GraphSource>({ ...row, pooledChildren: children.get(row.id) ?? [] }).filter(
          (member) => byId.has(member.memberChannelId),
        );
      const graph = new Map<string, RelayCapabilityGraphNode>();
      for (const row of sources)
        if (options.includeDisabled || enabled(row)) graph.set(row.id, { ...row, poolMembers: effectiveMembers(row) });
      const readCatalog = () =>
        tx.modelPricing.findMany({
          where: { status: 1 },
          select: { id: true, status: true, updateTime: true, model: true, provider: true, supportedFormats: true },
          orderBy: { id: "asc" },
        });
      const readPayload = async () => {
        const rows: Prisma.RelayChannelGetPayload<{ select: typeof relayChannelConfigurationReadSelect }>[] = [];
        for (let offset = 0; offset < targets.length; offset += limit) {
          await recheck();
          const batch = targets.slice(offset, offset + limit);
          const found = await tx.relayChannel.findMany({
            where: { id: { in: batch.map((row) => row.id) }, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
            select: relayChannelConfigurationReadSelect,
            orderBy: { id: "asc" },
          });
          if (
            found.length !== batch.length ||
            found.some(
              (row, i) => row.id !== batch[i]!.id || row.updateTime.getTime() !== batch[i]!.updateTime.getTime(),
            )
          )
            throw iamAccountDenied();
          rows.push(...found);
        }
        return rows;
      };
      const readPresence = async () => {
        const result = new Map<string, RelayChannelCredentialPresence>();
        for (let offset = 0; offset < targets.length; offset += limit) {
          const ids = targets.slice(offset, offset + limit).map((row) => row.id);
          // The database returns presence only. No encrypted credential crosses the application boundary.
          const rows = await tx.$queryRaw<
            { id: string; openai: unknown; anthropic: unknown; gemini: unknown }[]
          >(Prisma.sql`
            SELECT id, (openaiUpstreamApiKey IS NOT NULL AND OCTET_LENGTH(openaiUpstreamApiKey) > 0) AS openai,
              (anthropicUpstreamApiKey IS NOT NULL AND OCTET_LENGTH(anthropicUpstreamApiKey) > 0) AS anthropic,
              (geminiUpstreamApiKey IS NOT NULL AND OCTET_LENGTH(geminiUpstreamApiKey) > 0) AS gemini
            FROM relay_channels WHERE id IN (${Prisma.join(ids)}) ORDER BY id ASC`);
          if (
            rows.length !== ids.length ||
            new Set(rows.map((row) => row.id)).size !== ids.length ||
            rows.some((row) => !ids.includes(row.id))
          )
            throw iamAccountDenied();
          for (const row of rows)
            result.set(row.id, {
              hasOpenaiUpstreamApiKey: sqlBoolean(row.openai),
              hasAnthropicUpstreamApiKey: sqlBoolean(row.anthropic),
              hasGeminiUpstreamApiKey: sqlBoolean(row.gemini),
            });
        }
        return result;
      };
      const payload = await readPayload(),
        presence = await readPresence(),
        catalog = targets.length ? await readCatalog() : [];
      const result = await project({
        records: [...payload]
          .sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || b.id.localeCompare(a.id))
          .map((row) => {
            const graphRow = byId.get(row.id),
              hasPresence = presence.get(row.id);
            if (!graphRow || !hasPresence) throw iamAccountDenied();
            const parent = row.pooledParentId ? byId.get(row.pooledParentId) : undefined;
            return {
              source: {
                ...row,
                pooledParentId: parent?.id ?? null,
                pooledParent: parent ? { name: parent.name } : null,
                poolMembers: effectiveMembers(graphRow).map((member) => ({
                  ...member,
                  memberChannel: byId.get(member.memberChannelId),
                })),
              },
              presence: hasPresence,
            };
          }),
        context: { graph, modelCatalog: catalog, includeDisabled: options.includeDisabled },
      });
      const snapshotPresence = (value: Map<string, RelayChannelCredentialPresence>) => [...value];
      if (
        !same(initial.rows, (await scan(false)).rows) ||
        !same(visibility, await readVisibility()) ||
        !same(sources, await readGraph()) ||
        !same(payload, await readPayload()) ||
        !same(snapshotPresence(presence), snapshotPresence(await readPresence())) ||
        (targets.length && !same(catalog, await readCatalog()))
      )
        throw iamAccountDenied();
      return result;
    });
  }
}

import type { IamPrincipal } from "@quyan/shared";
import type { Prisma } from "@prisma/client";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { readIamPersonalCollection } from "../users/iam-personal-collection-read";
import { iamAccountDenied } from "../users/iam-account-principal";
import { relayChannelManagementSelect } from "./relay-channel.repository";
import type { RelayChannelManagementRecord } from "./relay-channel.store";
import type { buildRelayChannelManagementQuery } from "./relay-channel-management-query";
import type { RelayCapabilityGraphNode, RelayPoolResolverContext } from "@/services/relay/relay-pool-resolver.service";
import { resolveEffectiveRelayPoolMembers } from "@/services/relay/utils/relay-pool-members.util";
export type RelayChannelManagementReadQuery = ReturnType<typeof buildRelayChannelManagementQuery>;
export type RelayChannelManagementModelMatcher = (id: string, context: RelayPoolResolverContext) => Promise<boolean>;
export interface PlatformRelayChannelManagementReadStore {
  list(
    principal: IamPrincipal,
    query: RelayChannelManagementReadQuery,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
    matches: RelayChannelManagementModelMatcher,
  ): Promise<{ records: RelayChannelManagementRecord[]; total: number }>;
}
const capabilitySelect = {
  id: true,
  name: true,
  status: true,
  providerServiceEnabled: true,
  channelType: true,
  allowedFormats: true,
  allowedModels: true,
  modelMapping: true,
  routingConfig: true,
  pooledParentId: true,
  pooledPriority: true,
  pooledWeight: true,
  pooledMemberEnabled: true,
  updateTime: true,
  poolMembers: { select: { memberChannelId: true, priority: true, weight: true, enabled: true } },
} as const satisfies Prisma.RelayChannelSelect;
export class PlatformRelayChannelManagementReadRepository implements PlatformRelayChannelManagementReadStore {
  private static instance: PlatformRelayChannelManagementReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformRelayChannelManagementReadRepository());
  }
  async list(
    principal: IamPrincipal,
    query: RelayChannelManagementReadQuery,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
    matches: RelayChannelManagementModelMatcher,
  ) {
    const { where, page, pageSize, modelFilters } = query,
      limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !Number.isSafeInteger(page * pageSize)
    )
      throw iamAccountDenied();
    return readIamPersonalCollection(principal, decide, recheck, async (tx, checkedDecide) => {
      let after: string | undefined;
      const admitted: { id: string; updateTime: Date }[] = [];
      for (;;) {
        const rows = await tx.relayChannel.findMany({
          where: { status: { in: VISIBLE_RELAY_CHANNEL_STATUSES }, ...(after ? { id: { gt: after } } : {}) },
          select: { id: true, updateTime: true },
          orderBy: { id: "asc" },
          take: limit,
        });
        if (!rows.length) break;
        const outcomes = await checkedDecide(rows.map((row) => platformRelayChannelArn(row.id)));
        rows.forEach((row, index) => {
          if (outcomes[index] === "Allow") admitted.push(row);
        });
        after = rows[rows.length - 1]!.id;
        if (rows.length < limit) break;
      }
      const ids = admitted.map((row) => row.id),
        sources: Prisma.RelayChannelGetPayload<{ select: typeof capabilitySelect }>[] = [];
      for (let offset = 0; offset < ids.length; offset += limit) {
        const batch = ids.slice(offset, offset + limit),
          rows = await tx.relayChannel.findMany({
            where: { id: { in: batch }, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
            select: capabilitySelect,
          });
        if (
          rows.length !== batch.length ||
          rows.some(
            (row) =>
              !admitted.some((old) => old.id === row.id && old.updateTime.getTime() === row.updateTime.getTime()),
          )
        )
          throw iamAccountDenied();
        sources.push(...rows);
      }
      const byId = new Map(sources.map((row) => [row.id, row])),
        graph = new Map<string, RelayCapabilityGraphNode>();
      const childrenByParent = new Map<string, typeof sources>();
      for (const row of sources) {
        if (!row.pooledParentId) continue;
        const children = childrenByParent.get(row.pooledParentId) ?? [];
        children.push(row);
        childrenByParent.set(row.pooledParentId, children);
      }
      for (const row of sources) {
        const members = resolveEffectiveRelayPoolMembers<typeof row>({
          ...row,
          pooledChildren: childrenByParent.get(row.id) ?? [],
        });
        graph.set(row.id, {
          ...row,
          poolMembers: members
            .filter((member) => byId.has(member.memberChannelId))
            .map(({ memberChannelId, priority, weight, enabled }) => ({ memberChannelId, priority, weight, enabled })),
        });
      }
      const context: RelayPoolResolverContext = {
        graph,
        includeDisabled: true,
        modelCatalog: modelFilters.length
          ? await tx.modelPricing.findMany({
              where: { status: 1 },
              select: { model: true, provider: true, supportedFormats: true },
              orderBy: { model: "asc" },
            })
          : [],
      };
      const candidates: { id: string; updateTime: Date; createTime: Date }[] = [];
      // Query each permitted identity so an unbounded IN clause never reaches Prisma or MySQL.
      for (let offset = 0; offset < ids.length; offset += limit) {
        const rows = await tx.relayChannel.findMany({
          where: { AND: [where, { id: { in: ids.slice(offset, offset + limit) } }] },
          select: { id: true, updateTime: true, createTime: true },
        });
        for (const row of rows) if (!modelFilters.length || (await matches(row.id, context))) candidates.push(row);
      }
      candidates.sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || b.id.localeCompare(a.id));
      const records: RelayChannelManagementRecord[] = [];
      for (const target of candidates.slice((page - 1) * pageSize, page * pageSize)) {
        const row = await tx.relayChannel.findFirst({
          where: { AND: [where, { id: target.id }] },
          select: { ...relayChannelManagementSelect, pooledParent: false },
        });
        if (!row || row.updateTime.getTime() !== target.updateTime.getTime()) throw iamAccountDenied();
        const parent = row.pooledParentId ? byId.get(row.pooledParentId) : undefined;
        records.push({
          ...row,
          pooledParentId: parent?.id ?? null,
          pooledParent: parent ? { name: parent.name } : null,
          poolMembers: row.poolMembers.filter((member) => byId.has(member.memberChannelId)),
          pooledChildren: row.pooledChildren.filter((child) => byId.has(child.id)),
        });
      }
      return { records, total: candidates.length };
    });
  }
}

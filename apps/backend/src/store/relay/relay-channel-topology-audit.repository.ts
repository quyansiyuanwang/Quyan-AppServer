import { relayChannelVisibilityPrincipal } from "./relay-channel-visibility-principal";
import { isRelayChannelVisible } from "@/util/relay/relay-channel-visibility.util";
import type { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { DEFAULT_RELAY_CONFIG } from "@/constant/relay-config";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { platformRelayConfigurationArn } from "@/iam/resources/platform-relay-configuration-resources";
import { readIamPersonalCollection } from "../users/iam-personal-collection-read";
import { iamAccountDenied } from "../users/iam-account-principal";
import { relayConfigurationTopologyIssues } from "@/util/relay-configuration-topology";
import type { RelayChannelTopologyAuditDto } from "@/api/dto/relay/relay-channel.dto";
export const relayChannelTopologySelect = {
  id: true,
  status: true,
  updateTime: true,
  name: true,
  channelType: true,
  pooledParentId: true,
  poolMembers: { select: { memberChannelId: true }, orderBy: { memberChannelId: "asc" } },
} as const satisfies Prisma.RelayChannelSelect;
const metadata = { id: true, status: true, updateTime: true } as const satisfies Prisma.RelayChannelSelect;
export class RelayChannelTopologyAuditRepository {
  private static instance: RelayChannelTopologyAuditRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelTopologyAuditRepository());
  }
  async audit(
    principal: IamPrincipal,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
    hydrate: boolean,
  ): Promise<RelayChannelTopologyAuditDto | undefined> {
    return readIamPersonalCollection(principal, decide, recheck, async (tx, checkedDecide) => {
      const requireAll = async (resources: readonly string[]) => {
        if ((await checkedDecide(resources)).some((value) => value !== "Allow")) throw iamAccountDenied();
      };
      await requireAll([platformRelayConfigurationArn()]);
      const limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
      const scan = async (authorize: boolean) => {
        let after: string | undefined;
        const rows: { id: string; status: number; updateTime: Date }[] = [];
        for (;;) {
          await recheck();
          const batch = await tx.relayChannel.findMany({
            where: { status: { in: VISIBLE_RELAY_CHANNEL_STATUSES }, ...(after ? { id: { gt: after } } : {}) },
            select: metadata,
            orderBy: { id: "asc" },
            take: limit,
          });
          if (!batch.length) break;
          if (authorize) await requireAll(batch.map((row) => platformRelayChannelArn(row.id)));
          rows.push(...batch);
          after = batch[batch.length - 1]!.id;
          if (batch.length < limit) break;
        }
        return rows;
      };
      const targets = await scan(true),
        expectedTargets = JSON.stringify(targets);
      if (!hydrate) return undefined;
      // Only after full admission may the global graph and topology mode be read. No partial global proof.
      await recheck();
      const readConfiguration = () =>
        tx.relayConfig.findFirst({
          where: { status: 1 },
          select: { id: true, status: true, updateTime: true, channelTopologyMode: true },
          orderBy: [{ updateTime: "desc" }, { id: "desc" }],
        });
      const readVisibility = async () => {
        const values = [];
        const principalVisibility = await relayChannelVisibilityPrincipal(principal, tx);
        const { user, managementBypass, roleIds } = principalVisibility;
        for (let offset = 0; offset < targets.length; offset += limit) {
          const ids = targets.slice(offset, offset + limit).map((row) => row.id);
          const rows = await tx.relayChannel.findMany({
            where: { id: { in: ids }, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
            select: { id: true, visibilityMode: true, visibilityConfig: true },
            orderBy: { id: "asc" },
          });
          if (rows.length !== ids.length) throw iamAccountDenied();
          for (const row of rows)
            if (!managementBypass && !isRelayChannelVisible(row, { id: user.id, groupId: user.groupId, roleIds }))
              throw iamAccountDenied();
          values.push(...rows);
        }
        return { principalVisibility, values };
      };
      const visibility = JSON.stringify(await readVisibility());
      await recheck();
      const configuration = await readConfiguration(),
        expectedConfiguration = JSON.stringify(configuration),
        mode = configuration?.channelTopologyMode ?? DEFAULT_RELAY_CONFIG.channelTopologyMode;
      if (!["legacy", "strict-two-tier"].includes(mode)) throw iamAccountDenied();
      const readGraph = async () => {
        const graph: Prisma.RelayChannelGetPayload<{ select: typeof relayChannelTopologySelect }>[] = [];
        for (let offset = 0; offset < targets.length; offset += limit) {
          await recheck();
          const batch = targets.slice(offset, offset + limit);
          const rows = await tx.relayChannel.findMany({
            where: { status: { in: VISIBLE_RELAY_CHANNEL_STATUSES }, id: { in: batch.map((row) => row.id) } },
            select: relayChannelTopologySelect,
            orderBy: { id: "asc" },
          });
          if (
            rows.length !== batch.length ||
            rows.some(
              (row, i) =>
                row.id !== batch[i]!.id ||
                row.status !== batch[i]!.status ||
                row.updateTime.getTime() !== batch[i]!.updateTime.getTime(),
            )
          )
            throw iamAccountDenied();
          graph.push(...rows);
        }
        return graph;
      };
      const graph = await readGraph(),
        expectedGraph = JSON.stringify(graph),
        issues = relayConfigurationTopologyIssues(graph);
      if (
        JSON.stringify(await scan(false)) !== expectedTargets ||
        JSON.stringify(await readGraph()) !== expectedGraph ||
        JSON.stringify(await readConfiguration()) !== expectedConfiguration ||
        JSON.stringify(await readVisibility()) !== visibility
      )
        throw iamAccountDenied();
      return { mode: mode as RelayChannelTopologyAuditDto["mode"], canEnableStrict: issues.length === 0, issues };
    });
  }
}

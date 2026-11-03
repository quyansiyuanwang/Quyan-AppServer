import { relayProbeUpstreamConfigured } from "./relay-probe-read-target";
import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import type {
  RelayProbeOverviewQueryDto,
  RelayChannelProbeCustomerFacingTargetDto,
} from "@/api/dto/relay/relay-channel-probe.dto";
import {
  resolveProbeCustomerFacingTargets,
  type RelayChannelProbeTopologyItem,
} from "@/services/relay/relay-probe-topology";
import type { IamPrincipal } from "@quyan/shared";
import { VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import {
  platformRelayProbeAccountArn,
  platformRelayProbeProfileArn,
  platformRelayProbeRunArn,
} from "@/iam/resources/platform-relay-probe-resources";
import { readIamPersonalCollection } from "../users/iam-personal-collection-read";
import { iamAccountDenied } from "../users/iam-account-principal";
import type { ProbeChannelVisibilityRecord } from "./relay-probe-latest-run-read.repository";
import { relayProbeProfileReadSelect, type RelayProbeProfileReadRecord } from "./relay-probe-profile-read.repository";
import { relayProbeRunPublicSelect, type RelayProbeRunPublicRecord } from "./relay-probe-run-public-select";

/** This projection must never include upstream URLs, API keys, or unrelated channel configuration. */
const channelSelect = {
  id: true,
  name: true,
  channelType: true,
  status: true,
  visibilityMode: true,
  providerServiceEnabled: true,
  pooledMemberEnabled: true,
  multiplier: true,
  allowedFormats: true,
  allowedModels: true,
  createTime: true,
} as const satisfies Prisma.RelayChannelSelect;
const targetConfigSelect = {
  id: true,
  profileId: true,
  targetChannelId: true,
  accountId: true,
  probeFormat: true,
  probeModel: true,
  probePayload: true,
  probeGroup: true,
  createTime: true,
  updateTime: true,
} as const satisfies Prisma.RelayChannelProbeTargetConfigSelect;
type Channel = Prisma.RelayChannelGetPayload<{ select: typeof channelSelect }>;
type TargetConfig = Prisma.RelayChannelProbeTargetConfigGetPayload<{ select: typeof targetConfigSelect }>;
export interface RelayProbeOverviewTarget {
  channel: Channel;
  membershipEnabled: boolean;
  upstreamConfigured: boolean;
  targetConfig?: TargetConfig;
  latestRun?: RelayProbeRunPublicRecord;
}
export interface RelayProbeOverviewRecord extends RelayProbeOverviewTarget {
  profile?: RelayProbeProfileReadRecord;
  profileMembers: ReadonlySet<string>;
  members?: RelayProbeOverviewTarget[];
  memberCount?: number;
  hasCredentials?: boolean;
  customerFacingTargets?: RelayChannelProbeCustomerFacingTargetDto[];
}
export interface ProbeOverviewReadWindow extends RelayProbeOverviewQueryDto {
  page: number;
  pageSize: number;
  summary?: boolean;
  memberChannelId?: string;
  members?: { page: number; pageSize: number; onTotal: (total: number) => void };
  onTotal: (total: number) => void;
}
export class RelayProbeOverviewReadRepository {
  private static instance: RelayProbeOverviewReadRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeOverviewReadRepository());
  }
  async list<T>(
    principal: IamPrincipal | undefined,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    decideRelated: (action: string, resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
    visible: (channel: ProbeChannelVisibilityRecord) => Promise<boolean>,
    map: (records: RelayProbeOverviewRecord[]) => T,
    window?: ProbeOverviewReadWindow,
  ): Promise<T> {
    const decisions = new Map<string, Map<string, string>>(),
      limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    const related = async (action: string, resources: readonly string[]) => {
      const outcomes: string[] = [],
        previous = decisions.get(action) ?? new Map<string, string>();
      for (let offset = 0; offset < resources.length; offset += limit) {
        const batch = resources.slice(offset, offset + limit),
          results = await decideRelated(action, batch);
        if (
          !Array.isArray(results) ||
          results.length !== batch.length ||
          results.some((result) => !["Allow", "ExplicitDeny", "ImplicitDeny"].includes(result))
        )
          throw iamAccountDenied();
        batch.forEach((resource, index) => {
          if (previous.has(resource) && previous.get(resource) !== results[index]) throw iamAccountDenied();
          previous.set(resource, results[index]!);
        });
        outcomes.push(...results);
      }
      decisions.set(action, previous);
      return outcomes;
    };
    const stable = async () => {
      await recheck();
      for (const [action, values] of decisions) {
        const entries = [...values],
          current = await related(
            action,
            entries.map(([resource]) => resource),
          );
        if (current.some((value, index) => value !== entries[index]![1])) throw iamAccountDenied();
      }
    };
    const read = async (tx: Prisma.TransactionClient, checkedDecide: typeof decide) => {
      const channels = new Map<string, Channel>();
      let after: string | undefined;
      for (;;) {
        const metadata: { id: string; visibilityMode: string; visibilityConfig: Prisma.JsonValue | null }[] =
          await tx.relayChannel.findMany({
            where: { status: { in: VISIBLE_RELAY_CHANNEL_STATUSES }, ...(after ? { id: { gt: after } } : {}) },
            select: { id: true, visibilityMode: true, visibilityConfig: true },
            orderBy: { id: "asc" },
            take: limit,
          });
        if (!metadata.length) break;
        const results = await checkedDecide(metadata.map((row) => platformRelayChannelArn(row.id))),
          admitted: string[] = [];
        for (let index = 0; index < metadata.length; index++) {
          const row = metadata[index]!;
          if (results[index] === "Allow" && (await visible(row))) admitted.push(row.id);
        }
        if (admitted.length) {
          const rows = await tx.relayChannel.findMany({ where: { id: { in: admitted } }, select: channelSelect });
          if (rows.length !== admitted.length) throw iamAccountDenied();
          rows.forEach((row) => channels.set(row.id, row));
        }
        after = metadata[metadata.length - 1]!.id;
        if (metadata.length < limit) break;
      }
      const permitted = async (action: string, resources: string[]) => {
        const missing = resources.filter((resource) => !decisions.get(action)?.has(resource));
        if (missing.length) await related(action, [...new Set(missing)]);
        // All contributing grants are still evaluated again by stable() before returning data.
        return resources.every((resource) => decisions.get(action)?.get(resource) === "Allow");
      };
      // Topology contains only admitted public metadata. Strict membership takes precedence before filtering.
      const edgesByParent = new Map<string, { memberChannelId: string; enabled: boolean }[]>();
      for (const channel of channels.values()) {
        if (channel.channelType !== "pooled") continue;
        const children = await tx.relayChannel.findMany({
          where: { pooledParentId: channel.id },
          select: { id: true },
        });
        const edges = children.length
          ? children.map((row) => ({ memberChannelId: row.id, enabled: true }))
          : await tx.relayChannelMember.findMany({
              where: { relayChannelId: channel.id },
              select: { memberChannelId: true, enabled: true },
            });
        edgesByParent.set(channel.id, [
          ...new Map(
            edges.filter((edge) => channels.has(edge.memberChannelId)).map((edge) => [edge.memberChannelId, edge]),
          ).values(),
        ]);
      }
      const topology: RelayChannelProbeTopologyItem[] = [...channels.values()].map((channel) => ({
        id: channel.id,
        name: channel.name,
        channelType: channel.channelType as RelayChannelProbeTopologyItem["channelType"],
        enabled: channel.status === 1 && channel.providerServiceEnabled !== false,
        poolMembers: edgesByParent.get(channel.id)?.map((edge) => {
          const member = channels.get(edge.memberChannelId)!;
          return {
            ...edge,
            priority: 0,
            weight: 1,
            memberChannelEnabled:
              member.status === 1 && member.providerServiceEnabled !== false && member.pooledMemberEnabled !== false,
          };
        }),
      }));
      const filterProfiles =
        window && ((window.profile && window.profile !== "all") || window.group)
          ? await tx.relayChannelProbeProfile.findMany({
              where: { relayChannelId: { in: [...channels.keys()] } },
              select: { id: true, relayChannelId: true, probeGroup: true },
            })
          : [];
      const profileFilters = new Map(filterProfiles.map((profile) => [profile.relayChannelId, profile]));
      if (filterProfiles.length)
        await related("quyan:relay:GetProbeProfile", [
          ...new Set(
            filterProfiles.flatMap((profile) => [
              platformRelayChannelArn(profile.relayChannelId),
              platformRelayProbeProfileArn(profile.relayChannelId, profile.id),
            ]),
          ),
        ]);
      const eligible: Channel[] = [];
      for (const channel of channels.values()) {
        if (channel.channelType !== "standalone" && channel.channelType !== "pooled") continue;
        if (window?.channelId && window.channelId !== channel.id) continue;
        const search = window?.search?.toLowerCase();
        if (search && !channel.name.toLowerCase().includes(search) && !channel.id.toLowerCase().includes(search))
          continue;
        const enabled = channel.status === 1 && channel.providerServiceEnabled !== false;
        if (window?.enabled && window.enabled !== "all" && enabled !== (window.enabled === "enabled")) continue;
        if (window && ((window.profile && window.profile !== "all") || window.group)) {
          const profile = profileFilters.get(channel.id);
          const admitted =
            profile &&
            (await permitted("quyan:relay:GetProbeProfile", [
              platformRelayChannelArn(channel.id),
              platformRelayProbeProfileArn(channel.id, profile.id),
            ]));
          if (window.profile && window.profile !== "all" && Boolean(admitted) !== (window.profile === "configured"))
            continue;
          if (window.group) {
            if (!admitted || !profile) continue;
            const targetIds = [
              channel.id,
              ...(edgesByParent.get(channel.id) ?? []).map((edge) => edge.memberChannelId),
            ];
            const overrides = await tx.relayChannelProbeTargetConfig.findMany({
              where: { profileId: profile.id, targetChannelId: { in: targetIds } },
              select: { targetChannelId: true, accountId: true, probeGroup: true },
            });
            let matches = profile.probeGroup === window.group;
            for (const override of overrides) {
              if (matches) break;
              if (override.probeGroup !== window.group) continue;
              matches = await permitted("quyan:relay:GetProbeTargetConfig", [
                platformRelayChannelArn(channel.id),
                platformRelayChannelArn(override.targetChannelId),
                platformRelayProbeProfileArn(channel.id, profile.id),
                ...(override.accountId ? [platformRelayProbeAccountArn(override.accountId)] : []),
              ]);
            }
            if (!matches) continue;
          }
        }
        if (
          window &&
          ((window.runStatus && window.runStatus !== "all") || (window.suggestion && window.suggestion !== "all"))
        ) {
          const run =
            channel.channelType === "pooled"
              ? null
              : await tx.relayChannelProbeRun.findFirst({
                  where: { relayChannelId: channel.id, probeMemberChannelId: null },
                  orderBy: [{ createTime: "desc" }, { id: "desc" }],
                  select: {
                    id: true,
                    status: true,
                    suggestedMultiplier: true,
                    appliedAt: true,
                    calibrationStatus: true,
                  },
                });
          const admitted =
            run &&
            (await permitted("quyan:relay:ListLatestProbeRuns", [
              platformRelayChannelArn(channel.id),
              platformRelayProbeRunArn(channel.id, run.id),
            ]));
          const status = admitted ? run?.status : undefined;
          if (
            window.runStatus &&
            window.runStatus !== "all" &&
            (window.runStatus === "none" ? Boolean(status) : status !== window.runStatus)
          )
            continue;
          const applicable = Boolean(
            admitted &&
              run?.status === "succeeded" &&
              run.calibrationStatus === "verified" &&
              run.suggestedMultiplier !== null &&
              !run.appliedAt,
          );
          if (window.suggestion && window.suggestion !== "all" && applicable !== (window.suggestion === "applicable"))
            continue;
        }
        eligible.push(channel);
      }
      eligible.sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || b.id.localeCompare(a.id));
      window?.onTotal(eligible.length);
      const selected = window
        ? eligible.slice((window.page - 1) * window.pageSize, window.page * window.pageSize)
        : eligible;
      const output: RelayProbeOverviewRecord[] = [];
      for (const channel of selected) {
        if (channel.channelType !== "standalone" && channel.channelType !== "pooled") continue;
        const channelArn = platformRelayChannelArn(channel.id),
          members: RelayProbeOverviewTarget[] = [];
        if (channel.channelType === "pooled") {
          // Presence is tested before visibility or authorization filtering. Denying a strict child must never enable legacy fallback.
          const allEdges = (edgesByParent.get(channel.id) ?? []).filter(
            (edge) => !window?.memberChannelId || edge.memberChannelId === window.memberChannelId,
          );
          window?.members?.onTotal(allEdges.length);
          const edges = window?.summary
            ? []
            : window?.members
              ? allEdges.slice(
                  (window.members.page - 1) * window.members.pageSize,
                  window.members.page * window.members.pageSize,
                )
              : allEdges;
          const included = new Set<string>();
          for (const edge of edges) {
            const member = channels.get(edge.memberChannelId);
            if (!member || included.has(member.id)) continue;
            included.add(member.id);
            members.push({ channel: member, membershipEnabled: edge.enabled, upstreamConfigured: false });
          }
        }
        const metadata = await tx.relayChannelProbeProfile.findUnique({
          where: { relayChannelId: channel.id },
          select: { id: true, updateTime: true },
        });
        let profile: RelayProbeProfileReadRecord | undefined;
        const profileMembers = new Set<string>();
        if (
          metadata &&
          (await permitted("quyan:relay:GetProbeProfile", [
            channelArn,
            platformRelayProbeProfileArn(channel.id, metadata.id),
          ]))
        ) {
          const record = window?.summary
            ? await tx.relayChannelProbeProfile
                .findUnique({
                  where: { id: metadata.id },
                  select: {
                    ...relayProbeProfileReadSelect,
                    workflow: false,
                    probePayload: false,
                    encryptedCredentials: false,
                    credentialIv: false,
                    credentialAuthTag: false,
                  },
                })
                .then((row) =>
                  row
                    ? {
                        ...row,
                        workflow: [],
                        probePayload: {},
                        encryptedCredentials: null,
                        credentialIv: null,
                        credentialAuthTag: null,
                      }
                    : null,
                )
            : await tx.relayChannelProbeProfile.findUnique({
                where: { id: metadata.id },
                select: relayProbeProfileReadSelect,
              });
          if (
            !record ||
            record.relayChannelId !== channel.id ||
            record.updateTime.getTime() !== metadata.updateTime.getTime()
          )
            throw iamAccountDenied();
          profile = record;
          const grants = await related(
            "quyan:relay:GetProbeProfile",
            members.map((member) => platformRelayChannelArn(member.channel.id)),
          );
          members.forEach((member, index) => {
            if (grants[index] === "Allow") profileMembers.add(member.channel.id);
          });
        }
        const row: RelayProbeOverviewRecord = {
          channel,
          membershipEnabled: true,
          upstreamConfigured: false,
          profile,
          profileMembers,
          memberCount: edgesByParent.get(channel.id)?.length ?? 0,
          hasCredentials: Boolean(
            profile &&
              (await tx.relayChannelProbeProfile.count({
                where: { id: profile.id, encryptedCredentials: { not: null } },
              })),
          ),
          customerFacingTargets: resolveProbeCustomerFacingTargets(topology, channel.id),
          ...(channel.channelType === "pooled" ? { members } : {}),
        };
        const targets = channel.channelType === "pooled" ? members : [row];
        // A logical pool may have its own target settings, even though only its physical members have probe runs.
        for (const target of channel.channelType === "pooled" ? [row, ...members] : targets) {
          if (
            !metadata ||
            !(await permitted("quyan:relay:GetProbeTargetConfig", [
              channelArn,
              platformRelayChannelArn(target.channel.id),
              platformRelayProbeProfileArn(channel.id, metadata.id),
            ]))
          )
            continue;
          const identity = await tx.relayChannelProbeTargetConfig.findUnique({
            where: { profileId_targetChannelId: { profileId: metadata.id, targetChannelId: target.channel.id } },
            select: { id: true, accountId: true, updateTime: true },
          });
          if (
            !identity ||
            (identity.accountId &&
              !(await permitted("quyan:relay:GetProbeTargetConfig", [
                platformRelayProbeAccountArn(identity.accountId),
              ])))
          )
            continue;
          const config = await tx.relayChannelProbeTargetConfig.findUnique({
            where: { id: identity.id },
            select: { ...targetConfigSelect, probePayload: !window?.summary },
          });
          if (
            !config ||
            config.profileId !== metadata.id ||
            config.targetChannelId !== target.channel.id ||
            config.accountId !== identity.accountId ||
            config.updateTime.getTime() !== identity.updateTime.getTime()
          )
            throw iamAccountDenied();
          target.targetConfig = {
            ...config,
            probePayload: window?.summary ? null : (config as TargetConfig).probePayload,
          };
        }
        for (const target of targets) {
          const resources = [channelArn, platformRelayChannelArn(target.channel.id)];
          if (await permitted("quyan:relay:ListLatestProbeRuns", resources)) {
            const latest = await tx.relayChannelProbeRun.findFirst({
              where: {
                relayChannelId: channel.id,
                probeMemberChannelId: channel.channelType === "pooled" ? target.channel.id : null,
              },
              orderBy: [{ createTime: "desc" }, { id: "desc" }],
              select: { id: true, updateTime: true },
            });
            if (
              latest &&
              (await permitted("quyan:relay:ListLatestProbeRuns", [platformRelayProbeRunArn(channel.id, latest.id)]))
            ) {
              const run = await tx.relayChannelProbeRun.findUnique({
                where: { id: latest.id },
                select: window
                  ? {
                      ...relayProbeRunPublicSelect,
                      warmupUsage: false,
                      samples: false,
                      pricingSnapshot: false,
                      balanceSnapshots: false,
                      upstreamUsage: false,
                      costBreakdown: false,
                    }
                  : relayProbeRunPublicSelect,
              });
              if (
                !run ||
                run.relayChannelId !== channel.id ||
                run.probeMemberChannelId !== (channel.channelType === "pooled" ? target.channel.id : null) ||
                run.updateTime.getTime() !== latest.updateTime.getTime()
              )
                throw iamAccountDenied();
              target.latestRun = {
                ...run,
                ...(window
                  ? {
                      warmupUsage: null,
                      samples: null,
                      pricingSnapshot: null,
                      balanceSnapshots: null,
                      upstreamUsage: null,
                      costBreakdown: null,
                    }
                  : {}),
              };
            }
          }
          if (profile) {
            const format = target.targetConfig?.probeFormat ?? profile.probeFormat;
            target.upstreamConfigured = await relayProbeUpstreamConfigured(tx, target.channel.id, format);
          }
        }
        output.push(row);
      }
      output.sort(
        (left, right) =>
          right.channel.createTime.getTime() - left.channel.createTime.getTime() ||
          right.channel.id.localeCompare(left.channel.id),
      );
      return map(output);
    };
    if (principal) return readIamPersonalCollection(principal, decide, stable, read);
    // This branch is called exclusively by the service's legacy permission adapter.
    return prisma.$transaction(
      async (tx) => {
        const result = await read(tx, decide);
        await recheck();
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 },
    );
  }
}

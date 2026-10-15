import { Prisma } from "@prisma/client";
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
}
export class RelayProbeOverviewReadRepository {
  private static instance: RelayProbeOverviewReadRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeOverviewReadRepository());
  }
  async list<T>(
    principal: IamPrincipal,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    decideRelated: (action: string, resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
    visible: (channel: ProbeChannelVisibilityRecord) => Promise<boolean>,
    map: (records: RelayProbeOverviewRecord[]) => T,
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
    return readIamPersonalCollection(principal, decide, stable, async (tx, checkedDecide) => {
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
      const output: RelayProbeOverviewRecord[] = [];
      const permitted = async (action: string, resources: string[]) =>
        (await related(action, resources)).every((value) => value === "Allow");
      for (const channel of channels.values()) {
        if (channel.channelType !== "standalone" && channel.channelType !== "pooled") continue;
        const channelArn = platformRelayChannelArn(channel.id),
          members: RelayProbeOverviewTarget[] = [];
        if (channel.channelType === "pooled") {
          // Presence is tested before visibility or authorization filtering. Denying a strict child must never enable legacy fallback.
          const strict = await tx.relayChannel.count({ where: { pooledParentId: channel.id } });
          const edges = strict
            ? await tx.relayChannel
                .findMany({ where: { pooledParentId: channel.id }, select: { id: true } })
                .then((rows) => rows.map((row) => ({ memberChannelId: row.id, enabled: true })))
            : await tx.relayChannelMember.findMany({
                where: { relayChannelId: channel.id },
                select: { memberChannelId: true, enabled: true },
              });
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
          const record = await tx.relayChannelProbeProfile.findUnique({
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
            select: targetConfigSelect,
          });
          if (
            !config ||
            config.profileId !== metadata.id ||
            config.targetChannelId !== target.channel.id ||
            config.accountId !== identity.accountId ||
            config.updateTime.getTime() !== identity.updateTime.getTime()
          )
            throw iamAccountDenied();
          target.targetConfig = config;
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
                select: relayProbeRunPublicSelect,
              });
              if (
                !run ||
                run.relayChannelId !== channel.id ||
                run.probeMemberChannelId !== (channel.channelType === "pooled" ? target.channel.id : null) ||
                run.updateTime.getTime() !== latest.updateTime.getTime()
              )
                throw iamAccountDenied();
              target.latestRun = run;
            }
          }
          if (profile) {
            const format = target.targetConfig?.probeFormat ?? profile.probeFormat;
            const upstream =
              format === "openai" || format.startsWith("openai-")
                ? { openaiUpstreamUrl: { not: "" }, openaiUpstreamApiKey: { not: "" } }
                : format === "anthropic"
                  ? { anthropicUpstreamUrl: { not: "" }, anthropicUpstreamApiKey: { not: "" } }
                  : { geminiUpstreamUrl: { not: "" }, geminiUpstreamApiKey: { not: "" } };
            // Only the existence of usable upstream settings is needed; never load their values.
            target.upstreamConfigured =
              (await tx.relayChannel.count({ where: { id: target.channel.id, ...upstream } })) === 1;
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
    });
  }
}

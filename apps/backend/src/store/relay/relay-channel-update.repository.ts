import { isDeepStrictEqual as same } from "node:util";
import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { RELAY_CAPABILITY_RESOLUTION_LIMITS } from "@/constant/relay-capability";
import { ApiError, BadRequestError, ConflictError, InternalServerError } from "@/util/errors";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { readRelayChannelCredentialPresence } from "./relay-channel-credential-presence";
import { relayChannelChangeValidationSourceSelect } from "./relay-channel-change-request-create.repository";
import { RelayChannelRepository } from "./relay-channel.repository";
import type { RelayChannelProviderConfigRepository } from "./relay-channel-provider-config.repository";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
import type { RelayChannelCredentialPresence } from "@/services/relay/relay-channel-configuration-projection";
import type { RelayModelCatalogEntry } from "@/services/relay/relay-pool-resolver.service";
import type { SubmissionProviderInput } from "./relay-channel-submission-create.repository";
import type {
  UpdateRelayChannelRequest,
  RelayChannelProviderConfigRequest,
  RelayChannelMemberDto,
} from "@/api/dto/relay/relay-channel.dto";
const updatePolicy = Object.freeze({ timeoutMs: 30000 });
const edgeSelect = { id: true, memberChannelId: true, priority: true, weight: true, enabled: true } as const;
const nodeSelect = {
  id: true,
  status: true,
  updateTime: true,
  channelType: true,
  pooledParentId: true,
  poolMembers: {
    select: edgeSelect,
    orderBy: { memberChannelId: "asc" },
    take: RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes + 1,
  },
  pooledChildren: {
    where: { status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
    select: { id: true },
    orderBy: { id: "asc" },
    take: RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes + 1,
  },
  memberOfPools: {
    select: { relayChannelId: true },
    orderBy: { relayChannelId: "asc" },
    take: RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes + 1,
  },
} as const satisfies Prisma.RelayChannelSelect;
const providerSelect = {
  id: true,
  createTime: true,
  userId: true,
  status: true,
  updateTime: true,
  commissionPercent: true,
  settlementMode: true,
  settlementIntervalDays: true,
  settlementTime: true,
  nextSettlementAt: true,
  lastSettledAt: true,
} as const;
const sourceSelect = {
  ...relayChannelChangeValidationSourceSelect,
  providers: { select: providerSelect, orderBy: { userId: "asc" } },
} as const;
const userSelect = { id: true, status: true, updateTime: true, accountOwnerId: true, username: true } as const;
type Node = Prisma.RelayChannelGetPayload<{ select: typeof nodeSelect }>;
export type ChannelUpdateSource = Prisma.RelayChannelGetPayload<{ select: typeof sourceSelect }>;
type Providers = Awaited<ReturnType<RelayChannelProviderConfigRepository["providers"]>>;
export type ChannelUpdatePreparation = (
  input: UpdateRelayChannelRequest,
  source: ChannelUpdateSource,
  catalog: readonly RelayModelCatalogEntry[],
  presence: RelayChannelCredentialPresence,
  topologyMode: "legacy" | "strict-two-tier",
) => Promise<{
  patch: Prisma.RelayChannelUncheckedUpdateManyInput;
  channelType: string;
  members: RelayChannelMemberDto[] | null | undefined;
}>;
export type ChannelUpdateProviderPreparation = (
  input: RelayChannelProviderConfigRequest,
  userId: string,
  now: Date,
) => SubmissionProviderInput;
interface Guard {
  principal: IamPrincipal;
  snapshot: PlatformManagementReadSnapshot;
  recheck: (tx?: Prisma.TransactionClient) => Promise<void>;
  admit: (ids: readonly string[], providerIds?: readonly string[]) => Promise<void>;
}
// MySQL's channel/provider Decimal columns retain six fractional digits.
const storedDecimal = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
const providerValues = (row: {
  userId: string;
  commissionPercent: Prisma.Decimal | number;
  settlementMode: string;
  settlementIntervalDays?: number | null;
  settlementTime?: string | null;
  nextSettlementAt?: Date | null;
}) => ({
  userId: row.userId,
  commissionPercent: Number(storedDecimal(row.commissionPercent)),
  settlementMode: row.settlementMode,
  settlementIntervalDays: row.settlementIntervalDays ?? null,
  settlementTime: row.settlementTime ?? null,
  nextSettlementAt: row.nextSettlementAt ?? null,
});
/** No plaintext key is selected. This private ephemeral digest is never exposed in DTOs or logs. */
async function credentialRevision(tx: Prisma.TransactionClient, id: string, input: UpdateRelayChannelRequest = {}) {
  const rows = await tx.$queryRaw<{ revision: string }[]>(Prisma.sql`SELECT SHA2(JSON_ARRAY(
    IF(${input.openaiUpstreamApiKey !== undefined}, ${input.openaiUpstreamApiKey ?? null}, openaiUpstreamApiKey),
    IF(${input.anthropicUpstreamApiKey !== undefined}, ${input.anthropicUpstreamApiKey ?? null}, anthropicUpstreamApiKey),
    IF(${input.geminiUpstreamApiKey !== undefined}, ${input.geminiUpstreamApiKey ?? null}, geminiUpstreamApiKey)), 256) AS revision
    FROM relay_channels WHERE id=${id}`);
  if (rows.length !== 1 || !/^[a-f0-9]{64}$/i.test(rows[0]!.revision)) throw iamAccountDenied();
  return rows[0]!.revision;
}
/** Complete related-resource admission precedes configuration hydration; all writes and audit-final checks are atomic. */
export class RelayChannelUpdateRepository {
  private static instance: RelayChannelUpdateRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelUpdateRepository());
  }
  async apply<T>(
    id: string,
    input: UpdateRelayChannelRequest,
    targets: Providers | undefined,
    guard: Guard,
    persist: boolean,
    prepare: ChannelUpdatePreparation,
    prepareProvider: ChannelUpdateProviderPreparation,
    project: (tx: Prisma.TransactionClient) => Promise<{ value: T; verify: () => Promise<void> }>,
    audit: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
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
          const readNodes = (ids: readonly string[]) =>
            tx.relayChannel.findMany({
              where: { id: { in: [...ids] }, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
              select: nodeSelect,
              orderBy: { id: "asc" },
            });
          const topologyTouched = [
            "channelType",
            "poolMembers",
            "pooledParentId",
            "pooledPriority",
            "pooledWeight",
            "pooledMemberEnabled",
          ].some((key) => Object.hasOwn(input, key));
          const modes = new Map<string, number>([[id, topologyTouched ? 1 : 0]]),
            expanded = new Map<string, number>(),
            nodes = new Map<string, Node>();
          const need = (related: string, mode: number) => modes.set(related, Math.max(modes.get(related) ?? -1, mode));
          if (input.pooledParentId) need(input.pooledParentId, 0);
          for (const member of input.poolMembers ?? []) need(member.memberChannelId, 1);
          let pending = [...modes.keys()];
          while (pending.length) {
            if (
              modes.size >
              Math.min(IAM_AUTHORIZATION_LIMITS.resourcesPerRequest, RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes)
            )
              throw iamAccountDenied();
            await guard.admit(pending);
            const rows = await readNodes(pending);
            if (
              rows.length !== pending.length ||
              rows.some(
                (row) => !["standalone", "pooled-member", "pooled", "automatic-proxy-pool"].includes(row.channelType),
              )
            )
              throw iamAccountDenied();
            for (const row of rows) {
              if (
                [row.poolMembers.length, row.pooledChildren.length, row.memberOfPools.length].some(
                  (length) => length > RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes,
                )
              )
                throw iamAccountDenied();
              nodes.set(row.id, row);
              expanded.set(row.id, modes.get(row.id)!);
              if (!modes.get(row.id)) continue;
              if (row.pooledParentId) need(row.pooledParentId, 0);
              for (const edge of row.poolMembers) need(edge.memberChannelId, 1);
              if (row.channelType === "pooled") for (const child of row.pooledChildren) need(child.id, 1);
              if (row.id === id && input.channelType !== undefined && input.channelType !== row.channelType)
                for (const parent of row.memberOfPools) need(parent.relayChannelId, 0);
            }
            pending = [...modes.keys()].filter((key) => !nodes.has(key) || modes.get(key)! > expanded.get(key)!);
          }
          const graphIds = [...nodes.keys()].sort(),
            graph = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM relay_channels WHERE id IN (${Prisma.join(graphIds)}) ORDER BY id FOR UPDATE`,
          );
          if (!same(graph, await readNodes(graphIds))) throw iamAccountDenied();
          const readSource = () => tx.relayChannel.findUnique({ where: { id }, select: sourceSelect });
          // Providers are narrow relation metadata; authorize recipients before configuration reads.
          const providerBefore = await tx.relayChannelProvider.findMany({
            where: { relayChannelId: id },
            select: providerSelect,
            orderBy: { userId: "asc" },
          });
          const recipients =
            targets === undefined
              ? []
              : [
                  ...new Set([
                    ...providerBefore.filter((row) => row.status === 1).map((row) => row.userId),
                    ...targets.map((row) => row.user.id),
                  ]),
                ].sort();
          await guard.admit([], recipients);
          const userIds = [...new Set([...guard.snapshot.users.map((row) => row.id), ...recipients])].sort();
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(userIds)}) ORDER BY id FOR UPDATE`,
          );
          const readUsers = () =>
            tx.user.findMany({ where: { id: { in: userIds } }, select: userSelect, orderBy: { id: "asc" } });
          const users = await readUsers();
          if (
            users.length !== userIds.length ||
            targets?.some(
              (row) =>
                !same(
                  row.user,
                  users.find((user) => user.id === row.user.id),
                ),
            )
          )
            throw iamAccountDenied();
          const source = await readSource();
          if (!source || !same(source.providers, providerBefore)) throw iamAccountDenied();
          const readCatalog = () =>
            tx.modelPricing.findMany({
              where: { status: 1 },
              select: { id: true, status: true, updateTime: true, model: true, provider: true, supportedFormats: true },
              orderBy: { id: "asc" },
            });
          const readTopology = () =>
            tx.relayConfig.findMany({
              where: { status: 1 },
              select: { id: true, status: true, updateTime: true, channelTopologyMode: true },
              orderBy: { id: "asc" },
            });
          const catalog = await readCatalog(),
            topology = await readTopology(),
            flags = (await readRelayChannelCredentialPresence(tx, [id])).get(id),
            credentialBefore = await credentialRevision(tx, id),
            credentialExpected = await credentialRevision(tx, id, input);
          if (!flags) throw iamAccountDenied();
          if (topology.length !== 1 || !["legacy", "strict-two-tier"].includes(topology[0]!.channelTopologyMode))
            throw iamAccountDenied();
          const mode = topology[0]!.channelTopologyMode as "legacy" | "strict-two-tier";
          const prepared = await prepare(input, source, catalog, flags, mode),
            patch = prepared.patch;
          if (typeof patch.name !== "string" || patch.channelType !== prepared.channelType) throw iamAccountDenied();
          if (
            await tx.relayChannel.findFirst({
              where: { name: patch.name, id: { not: id }, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
              select: { id: true },
            })
          )
            throw new ConflictError("Channel name is unavailable", undefined, {
              messageKey: "relayChannel.nameExists",
            });
          if (
            patch.visibilityMode === "hidden" &&
            source.visibilityMode !== "hidden" &&
            (await RelayChannelRepository.getInstance().countDirectBusinessReferences(id, tx))
          )
            throw new BadRequestError("Channel has direct business references", undefined, {
              messageKey: "relayChannel.hideBlockedByAssignments",
            });
          let replaceEdges: RelayChannelMemberDto[] | undefined;
          if (topologyTouched) {
            const root = nodes.get(id)!;
            if (
              prepared.channelType === "pooled-member" &&
              (typeof patch.pooledParentId !== "string" ||
                patch.pooledParentId === id ||
                nodes.get(patch.pooledParentId)?.channelType !== "pooled")
            )
              throw new BadRequestError("Invalid physical channel parent", undefined, {
                messageKey: "relay.pooledParentInvalid",
              });
            if (prepared.channelType !== "pooled" && root.pooledChildren.length)
              throw new BadRequestError("Logical pool still owns physical children", undefined, {
                messageKey: "relay.pooledParentInvalid",
              });
            if (!["standalone", "pooled"].includes(prepared.channelType))
              for (const parent of root.memberOfPools) {
                if (nodes.get(parent.relayChannelId)?.channelType === "automatic-proxy-pool")
                  throw new BadRequestError("Automatic pool references the changing channel", undefined, {
                    messageKey: "relay.automaticPoolMembersMustBePooledOrStandalone",
                  });
              }
            if (
              ["standalone", "pooled-member"].includes(prepared.channelType) ||
              (prepared.channelType === "pooled" && mode === "strict-two-tier")
            )
              replaceEdges = [];
            else if (prepared.members !== undefined) replaceEdges = prepared.members ?? [];
            const edges = (key: string): string[] => {
              const node = nodes.get(key)!;
              if (!node) throw iamAccountDenied();
              if (!modes.get(key)) return [];
              const type = key === id ? prepared.channelType : node.channelType;
              if (!["pooled", "automatic-proxy-pool"].includes(type)) return [];
              const members = key === id && replaceEdges !== undefined ? replaceEdges : node.poolMembers;
              if (
                type === "automatic-proxy-pool" &&
                members.some(
                  (edge) =>
                    !["standalone", "pooled"].includes(
                      edge.memberChannelId === id
                        ? prepared.channelType
                        : (nodes.get(edge.memberChannelId)?.channelType ?? ""),
                    ),
                )
              )
                throw new BadRequestError("Invalid automatic pool member type", undefined, {
                  messageKey: "relay.automaticPoolMembersMustBePooledOrStandalone",
                });
              return [
                ...new Set([
                  ...members.map((edge) => edge.memberChannelId),
                  ...(type === "pooled"
                    ? node.pooledChildren
                        .map((child) => child.id)
                        .filter((child) => child !== id || patch.pooledParentId === key)
                    : []),
                ]),
              ];
            };
            const heights = new Map<string, number>(),
              visiting = new Set<string>();
            const visit = (key: string, depth: number): number => {
              if (visiting.has(key) || depth > RELAY_CAPABILITY_RESOLUTION_LIMITS.poolDepth)
                throw new BadRequestError("Invalid channel graph", undefined, { messageKey: "relay.poolCycle" });
              const known = heights.get(key);
              if (known !== undefined) {
                if (depth + known > RELAY_CAPABILITY_RESOLUTION_LIMITS.poolDepth)
                  throw new BadRequestError("Channel graph is too deep", undefined, { messageKey: "relay.poolCycle" });
                return known;
              }
              visiting.add(key);
              let height = 0;
              for (const child of edges(key)) height = Math.max(height, 1 + visit(child, depth + 1));
              visiting.delete(key);
              heights.set(key, height);
              return height;
            };
            visit(id, 0);
          }
          const expectedFlags = { ...flags };
          if (input.openaiUpstreamApiKey !== undefined)
            expectedFlags.hasOpenaiUpstreamApiKey = Boolean(input.openaiUpstreamApiKey);
          if (input.anthropicUpstreamApiKey !== undefined)
            expectedFlags.hasAnthropicUpstreamApiKey = Boolean(input.anthropicUpstreamApiKey);
          if (input.geminiUpstreamApiKey !== undefined)
            expectedFlags.hasGeminiUpstreamApiKey = Boolean(input.geminiUpstreamApiKey);
          const verifyInputs = async () => {
            if (
              !same(catalog, await readCatalog()) ||
              !same(topology, await readTopology()) ||
              !same(users, await readUsers()) ||
              (await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision
            )
              throw iamAccountDenied();
          };
          await guard.recheck(tx);
          await verifyInputs();
          if (
            !same(source, await readSource()) ||
            !same(graph, await readNodes(graphIds)) ||
            (await credentialRevision(tx, id)) !== credentialBefore
          )
            throw iamAccountDenied();
          if (!persist) return undefined;
          const changed = await tx.relayChannel.updateMany({
            where: { id, status: source.status, updateTime: source.updateTime },
            data: patch,
          });
          if (changed.count !== 1) throw iamAccountDenied();
          if (replaceEdges !== undefined)
            await RelayChannelRepository.getInstance().replaceMembersByChannelId(id, replaceEdges, tx);
          const now = new Date(),
            expectedProviders = targets?.map((target) =>
              providerValues(prepareProvider(target.input, target.user.id, now)),
            );
          if (targets) {
            if (expectedProviders!.some((row, index) => row.userId !== targets[index]!.user.id))
              throw iamAccountDenied();
            await RelayChannelRepository.getInstance().replaceProvidersByChannelId(
              id,
              expectedProviders!.map((row) => ({
                ...row,
                settlementIntervalDays: row.settlementIntervalDays ?? undefined,
                settlementTime: row.settlementTime ?? undefined,
              })),
              tx,
            );
          }
          const after = await readSource(),
            graphAfter = await readNodes(graphIds);
          if (!after || graphAfter.length !== graph.length) throw iamAccountDenied();
          // Prove the graph is precisely the intended edge/parent transformation, not just a stable post-write snapshot.
          const rootBefore = nodes.get(id)!;
          const expectedRootMembers = replaceEdges ?? rootBefore.poolMembers;
          const sortedIds = (values: readonly string[]) => [...values].sort();
          for (const beforeNode of graph) {
            const afterNode = graphAfter.find((node) => node.id === beforeNode.id);
            if (!afterNode) throw iamAccountDenied();
            const expectedChildren = beforeNode.pooledChildren
              .filter((child) => child.id !== id)
              .map((child) => child.id);
            if (after.pooledParentId === beforeNode.id) expectedChildren.push(id);
            const expectedParents = beforeNode.memberOfPools
              .filter((parent) => parent.relayChannelId !== id)
              .map((parent) => parent.relayChannelId);
            if (expectedRootMembers.some((edge) => edge.memberChannelId === beforeNode.id)) expectedParents.push(id);
            const omitRelations = (node: Node) => {
              const { poolMembers: _edges, pooledChildren: _children, memberOfPools: _parents, ...values } = node;
              return values;
            };
            const expectedNode = omitRelations(beforeNode);
            if (beforeNode.id === id)
              Object.assign(expectedNode, {
                channelType: after.channelType,
                pooledParentId: after.pooledParentId,
                updateTime: after.updateTime,
              });
            if (
              !same(omitRelations(afterNode), expectedNode) ||
              !same(sortedIds(afterNode.pooledChildren.map((child) => child.id)), sortedIds(expectedChildren)) ||
              !same(
                sortedIds(afterNode.memberOfPools.map((parent) => parent.relayChannelId)),
                sortedIds(expectedParents),
              )
            )
              throw iamAccountDenied();
            if (beforeNode.id !== id || replaceEdges === undefined) {
              if (!same(afterNode.poolMembers, beforeNode.poolMembers)) throw iamAccountDenied();
            } else {
              const terms = (
                edges: readonly {
                  memberChannelId: string;
                  priority: number;
                  weight?: number | Prisma.Decimal;
                  enabled?: boolean;
                }[],
              ) =>
                edges
                  .map(({ memberChannelId, priority, weight, enabled }) => ({
                    memberChannelId,
                    priority,
                    weight: Number(storedDecimal(weight ?? 1)),
                    enabled: enabled !== false,
                  }))
                  .sort((a, b) => a.memberChannelId.localeCompare(b.memberChannelId));
              if (!same(terms(afterNode.poolMembers), terms(replaceEdges))) throw iamAccountDenied();
            }
          }
          for (const [key, expected] of Object.entries(patch)) {
            if (expected === undefined || key.endsWith("UpstreamApiKey")) continue;
            const actual = after[key as keyof ChannelUpdateSource];
            if (
              actual instanceof Prisma.Decimal
                ? !actual.equals(storedDecimal(expected as Prisma.Decimal.Value))
                : !same(actual, expected === Prisma.JsonNull || expected === Prisma.DbNull ? null : expected)
            )
              throw iamAccountDenied();
          }
          // No incidental status, review, ownership or provider changes may be hidden by the response projection.
          const beforeRest = { ...source } as Record<string, unknown>,
            afterRest = { ...after } as Record<string, unknown>;
          for (const key of [...Object.keys(patch), "updateTime", ...(targets ? ["providers"] : [])]) {
            delete beforeRest[key];
            delete afterRest[key];
          }
          if (!same(beforeRest, afterRest)) throw iamAccountDenied();
          if (
            expectedProviders &&
            !same(
              after.providers.filter((row) => row.status === 1).map((row) => providerValues(row)),
              expectedProviders,
            )
          )
            throw iamAccountDenied();
          const expectedRecipientIds = [
            ...new Set([
              ...source.providers.map((row) => row.userId),
              ...(expectedProviders ?? []).map((row) => row.userId),
            ]),
          ].sort();
          if (!same(after.providers.map((row) => row.userId).sort(), expectedRecipientIds)) throw iamAccountDenied();
          for (const old of source.providers) {
            const current = after.providers.find((row) => row.id === old.id);
            if (
              !current ||
              current.userId !== old.userId ||
              !same(old.lastSettledAt, current.lastSettledAt) ||
              !same(old.createTime, current.createTime)
            )
              throw iamAccountDenied();
            if (expectedProviders && !expectedProviders.some((row) => row.userId === old.userId)) {
              if (old.status !== 1 && !same(old, current)) throw iamAccountDenied();
              const { updateTime: _oldTime, ...oldValues } = old;
              const { updateTime: _newTime, ...newValues } = current;
              if (!same(newValues, { ...oldValues, status: old.status === 1 ? 0 : old.status }))
                throw iamAccountDenied();
            }
          }
          for (const row of after.providers) {
            if (!source.providers.some((old) => old.userId === row.userId) && row.lastSettledAt !== null)
              throw iamAccountDenied();
          }
          const projectResult = await project(tx);
          const verify = async () => {
            await verifyInputs();
            await projectResult.verify();
            if (
              !same(after, await readSource()) ||
              !same(graphAfter, await readNodes(graphIds)) ||
              (await credentialRevision(tx, id)) !== credentialExpected ||
              !same((await readRelayChannelCredentialPresence(tx, [id])).get(id), expectedFlags)
            )
              throw iamAccountDenied();
            if (
              (await tx.relayChannel.count({
                where: { name: after.name, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
              })) !== 1
            )
              throw iamAccountDenied();
          };
          await verify();
          await guard.recheck(tx);
          await audit(tx);
          await guard.recheck(tx);
          await verify();
          return projectResult.value;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: updatePolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028", "P2002"].includes(error.code))
        throw new ConflictError("Channel update context changed", undefined, { messageKey: "errors.conflict" });
      if (error instanceof ApiError) throw error;
      throw new InternalServerError("Channel update failed", undefined, { messageKey: "errors.internalServerError" });
    }
  }
}

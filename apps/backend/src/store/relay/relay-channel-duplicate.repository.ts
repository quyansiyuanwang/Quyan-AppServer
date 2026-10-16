import { assertRelayChannelGraph } from "@/util/relay-channel-graph";
import { isDeepStrictEqual as same } from "node:util";
import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { RELAY_CHANNEL_STATUS, VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { RELAY_CAPABILITY_RESOLUTION_LIMITS } from "@/constant/relay-capability";
import { ApiError, BadRequestError, ConflictError, InternalServerError } from "@/util/errors";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { readRelayChannelCredentialPresence } from "./relay-channel-credential-presence";
import { relayChannelChangeValidationSourceSelect } from "./relay-channel-change-request-create.repository";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
import type { RelayChannelCredentialPresence } from "@/services/relay/relay-channel-configuration-projection";
import type { RelayModelCatalogEntry } from "@/services/relay/relay-pool-resolver.service";
const copyPolicy = Object.freeze({ timeoutMs: 30000 });
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
} as const satisfies Prisma.RelayChannelSelect;
const sourceSelect = { ...relayChannelChangeValidationSourceSelect, poolMembers: nodeSelect.poolMembers } as const;
type Node = Prisma.RelayChannelGetPayload<{ select: typeof nodeSelect }>;
export type ChannelDuplicateSource = Prisma.RelayChannelGetPayload<{ select: typeof sourceSelect }>;
export type ChannelDuplicatePreparation = (
  source: ChannelDuplicateSource,
  name: string,
  catalog: readonly RelayModelCatalogEntry[],
  presence: RelayChannelCredentialPresence,
  topologyMode: "legacy" | "strict-two-tier",
) => Promise<Prisma.RelayChannelUncheckedCreateInput>;
interface Guard {
  principal: IamPrincipal;
  snapshot: PlatformManagementReadSnapshot;
  recheck: (tx?: Prisma.TransactionClient) => Promise<void>;
  admit: (ids: readonly string[]) => Promise<void>;
}
export interface ChannelCopyTarget {
  sourceId: string;
  id: string;
  name?: string;
}
/** Secrets stay inside SQL: no selected plaintext, rich source includes, provider grants or financial relations. */
export class RelayChannelDuplicateRepository {
  private static instance: RelayChannelDuplicateRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelDuplicateRepository());
  }
  async apply<T>(
    targets: readonly ChannelCopyTarget[],
    guard: Guard,
    persist: boolean,
    prepare: ChannelDuplicatePreparation,
    copyName: (name: string, reserved: Set<string>) => string,
    project: (
      tx: Prisma.TransactionClient,
      ids: readonly string[],
    ) => Promise<{ value: T[]; verify: () => Promise<void> }>,
    audit: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    const sourceIds = targets.map((row) => row.sourceId),
      destinations = new Set(targets.map((row) => row.id));
    if (
      !targets.length ||
      new Set(sourceIds).size !== targets.length ||
      destinations.size !== targets.length ||
      sourceIds.some((id) => destinations.has(id))
    )
      throw iamAccountDenied();
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
              await platformManagementGroupSnapshot(guard.principal, Permission.RELAY_CHANNEL_CREATE, tx),
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
          const nodes = new Map<string, Node>();
          // 0: parent ownership proof only, 1: copy this node's configured edges, 2: existing dependency capabilities.
          const traversal = new Map(sourceIds.map((id) => [id, 1])),
            expanded = new Map<string, number>();
          let pending = [...sourceIds];
          while (pending.length) {
            await guard.admit(pending);
            await guard.recheck(tx);
            const rows = await readNodes(pending);
            if (
              rows.length !== pending.length ||
              rows.some(
                (row) =>
                  !pending.includes(row.id) ||
                  !["standalone", "pooled-member", "pooled", "automatic-proxy-pool"].includes(row.channelType),
              )
            )
              throw iamAccountDenied();
            for (const row of rows) {
              if (
                row.poolMembers.length > RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes ||
                row.pooledChildren.length > RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes
              )
                throw iamAccountDenied();
              nodes.set(row.id, row);
            }
            const need = (id: string, mode: number) => traversal.set(id, Math.max(traversal.get(id) ?? -1, mode));
            for (const row of rows) {
              const mode = traversal.get(row.id)!;
              expanded.set(row.id, mode);
              if (mode === 0) continue;
              if (row.pooledParentId) need(row.pooledParentId, 0);
              for (const edge of row.poolMembers) need(edge.memberChannelId, 2);
              if (mode === 2 && row.channelType === "pooled") for (const child of row.pooledChildren) need(child.id, 2);
            }
            pending = [...traversal.keys()].filter((id) => !nodes.has(id) || traversal.get(id)! > expanded.get(id)!);
            if (
              traversal.size + targets.length >
              Math.min(IAM_AUTHORIZATION_LIMITS.resourcesPerRequest, RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes)
            )
              throw iamAccountDenied();
          }
          const graphIds = [...nodes.keys()].sort(),
            graph = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM relay_channels WHERE id IN (${Prisma.join(graphIds)}) ORDER BY id FOR UPDATE`,
          );
          if (!same(graph, await readNodes(graphIds))) throw iamAccountDenied();
          assertRelayChannelGraph(sourceIds, (id) => {
            const row = nodes.get(id);
            if (!row) throw iamAccountDenied();
            if (traversal.get(id) === 0) return [];
            return [
              ...row.poolMembers.map((edge) => edge.memberChannelId),
              ...(traversal.get(id) === 2 && row.channelType === "pooled"
                ? row.pooledChildren.map((child) => child.id)
                : []),
            ];
          });
          const readSources = () =>
              tx.relayChannel.findMany({
                where: { id: { in: sourceIds } },
                select: sourceSelect,
                orderBy: { id: "asc" },
              }),
            readCatalog = () =>
              tx.modelPricing.findMany({
                where: { status: 1 },
                select: {
                  id: true,
                  status: true,
                  updateTime: true,
                  model: true,
                  provider: true,
                  supportedFormats: true,
                },
                orderBy: { id: "asc" },
              }),
            readTopology = () =>
              tx.relayConfig.findMany({
                where: { status: 1 },
                select: { id: true, status: true, updateTime: true, channelTopologyMode: true },
                orderBy: { id: "asc" },
              });
          const sources = await readSources(),
            catalog = await readCatalog(),
            topology = await readTopology(),
            presence = await readRelayChannelCredentialPresence(tx, sourceIds);
          if (topology.length !== 1 || !["legacy", "strict-two-tier"].includes(topology[0]!.channelTopologyMode))
            throw iamAccountDenied();
          const topologyMode = topology[0]!.channelTopologyMode as "legacy" | "strict-two-tier";
          const names = await tx.relayChannel.findMany({
              where: { status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
              select: { name: true },
            }),
            reserved = new Set(names.map((row) => row.name));
          const responses: { value: T[]; verify: () => Promise<void> }[] = [],
            created: ChannelDuplicateSource[] = [];
          await guard.recheck(tx);
          for (const target of targets) {
            const source = sources.find((row) => row.id === target.sourceId);
            if (!source) throw iamAccountDenied();
            const name = target.name ?? copyName(source.name, reserved);
            if (
              await tx.relayChannel.findFirst({
                where: { name, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
                select: { id: true },
              })
            )
              throw new ConflictError("Channel copy name already exists", undefined, {
                messageKey: "relayChannel.nameExists",
              });
            reserved.add(name);
            const data = await prepare(source, name, catalog, presence.get(source.id)!, topologyMode);
            if (
              data.name !== name ||
              ["openaiUpstreamApiKey", "anthropicUpstreamApiKey", "geminiUpstreamApiKey"].some(
                (key) => data[key as keyof typeof data] !== undefined,
              )
            )
              throw iamAccountDenied();
            if (
              data.channelType === "pooled-member" &&
              (!data.pooledParentId || nodes.get(data.pooledParentId)?.channelType !== "pooled")
            )
              throw new BadRequestError("Invalid physical channel parent", undefined, {
                messageKey: "relay.pooledParentInvalid",
              });
            if (
              data.channelType === "automatic-proxy-pool" &&
              source.poolMembers.some(
                (edge) => !["standalone", "pooled"].includes(nodes.get(edge.memberChannelId)!.channelType),
              )
            )
              throw new BadRequestError("Invalid automatic pool member type", undefined, {
                messageKey: "relay.automaticPoolMembersMustBePooledOrStandalone",
              });
            if (!persist) continue;
            await tx.relayChannel.create({
              data: {
                ...data,
                id: target.id,
                status: RELAY_CHANNEL_STATUS.ENABLED,
                providerServiceEnabled: true,
                submissionStatus: "approved",
                submittedByUserId: null,
                reviewedByUserId: null,
                reviewedAt: null,
                reviewReason: null,
              },
              select: { id: true },
            });
            // SQL copies values without ever returning or logging plaintext to JavaScript.
            await tx.$executeRaw(Prisma.sql`UPDATE relay_channels AS dst JOIN relay_channels AS src ON src.id=${source.id}
            SET dst.openaiUpstreamApiKey=src.openaiUpstreamApiKey, dst.anthropicUpstreamApiKey=src.anthropicUpstreamApiKey, dst.geminiUpstreamApiKey=src.geminiUpstreamApiKey
            WHERE dst.id=${target.id}`);
            if (["pooled", "automatic-proxy-pool"].includes(data.channelType ?? "") && source.poolMembers.length)
              await tx.relayChannelMember.createMany({
                data: source.poolMembers.map((edge) => ({
                  relayChannelId: target.id,
                  memberChannelId: edge.memberChannelId,
                  priority: edge.priority,
                  weight: edge.weight,
                  enabled: edge.enabled,
                })),
              });
            const after = await tx.relayChannel.findUnique({ where: { id: target.id }, select: sourceSelect });
            if (
              !after ||
              after.status !== RELAY_CHANNEL_STATUS.ENABLED ||
              !after.providerServiceEnabled ||
              after.submissionStatus !== "approved" ||
              after.submittedByUserId !== null ||
              after.reviewedByUserId !== null ||
              after.reviewedAt !== null ||
              after.reviewReason !== null
            )
              throw iamAccountDenied();
            const edgeValues = (edges: readonly Node["poolMembers"][number][]) =>
              edges.map((edge) => ({
                memberChannelId: edge.memberChannelId,
                priority: edge.priority,
                weight: edge.weight,
                enabled: edge.enabled,
              }));
            const expectedEdges = ["pooled", "automatic-proxy-pool"].includes(data.channelType ?? "")
              ? edgeValues(source.poolMembers)
              : [];
            if (!same(edgeValues(after.poolMembers), expectedEdges)) throw iamAccountDenied();
            for (const [key, expected] of Object.entries(data)) {
              if (expected === undefined) continue;
              const actual = after[key as keyof typeof after];
              if (
                actual instanceof Prisma.Decimal
                  ? !actual.equals(expected as Prisma.Decimal.Value)
                  : !same(actual, expected === Prisma.JsonNull || expected === Prisma.DbNull ? null : expected)
              )
                throw iamAccountDenied();
            }
            created.push(after);
          }
          if (persist) {
            const response = await project(
              tx,
              targets.map((row) => row.id),
            );
            if (response.value.length !== targets.length) throw iamAccountDenied();
            responses.push(response);
          }
          const verify = async () => {
            for (const response of responses) await response.verify();
            const current = (await readNodes(graphIds)).map((row) => ({
              ...row,
              pooledChildren: row.pooledChildren.filter((child) => !destinations.has(child.id)),
            }));
            if (
              !same(graph, current) ||
              !same(sources, await readSources()) ||
              !same(catalog, await readCatalog()) ||
              !same(topology, await readTopology()) ||
              !same(presence, await readRelayChannelCredentialPresence(tx, sourceIds)) ||
              (await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision
            )
              throw iamAccountDenied();
            if (persist) {
              const currentCreated = await tx.relayChannel.findMany({
                where: { id: { in: [...destinations] } },
                select: sourceSelect,
                orderBy: { id: "asc" },
              });
              if (
                !same(
                  [...created].sort((a, b) => a.id.localeCompare(b.id)),
                  currentCreated,
                ) ||
                (await tx.relayChannelProvider.count({ where: { relayChannelId: { in: [...destinations] } } })) !== 0 ||
                (await tx.relayChannel.count({ where: { pooledParentId: { in: [...destinations] } } })) !== 0
              )
                throw iamAccountDenied();
              for (const row of created) {
                if (
                  (await tx.relayChannel.count({
                    where: { name: row.name, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
                  })) !== 1
                )
                  throw iamAccountDenied();
              }
              for (const target of targets) {
                const rows = await tx.$queryRaw<{ matched: unknown }[]>(Prisma.sql`SELECT
                ((dst.openaiUpstreamApiKey <=> src.openaiUpstreamApiKey) AND (dst.anthropicUpstreamApiKey <=> src.anthropicUpstreamApiKey) AND (dst.geminiUpstreamApiKey <=> src.geminiUpstreamApiKey)) AS matched
                FROM relay_channels AS dst JOIN relay_channels AS src ON src.id=${target.sourceId} WHERE dst.id=${target.id}`);
                if (rows.length !== 1 || ![true, 1, 1n].includes(rows[0]!.matched as boolean | number | bigint))
                  throw iamAccountDenied();
              }
            }
          };
          await verify();
          await guard.recheck(tx);
          if (persist) await audit(tx);
          await guard.recheck(tx);
          await verify();
          return responses.flatMap((row) => row.value);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: copyPolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028", "P2002"].includes(error.code))
        throw new ConflictError("Channel copy context changed", undefined, { messageKey: "errors.conflict" });
      if (error instanceof ApiError) throw error;
      throw new InternalServerError("Channel copy failed", undefined, { messageKey: "errors.internalServerError" });
    }
  }
}

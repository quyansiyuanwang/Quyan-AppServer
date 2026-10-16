import { isDeepStrictEqual as same } from "node:util";
import { Prisma } from "@prisma/client";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { RELAY_CHANNEL_STATUS, VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { RELAY_CAPABILITY_RESOLUTION_LIMITS } from "@/constant/relay-capability";
import { assertRelayChannelGraph } from "@/util/relay-channel-graph";
import { ApiError, BadRequestError, ConflictError, InternalServerError } from "@/util/errors";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { RelayChannelRepository } from "./relay-channel.repository";
import type { CreateRelayChannelRequest } from "@/api/dto/relay/relay-channel.dto";
import {
  creationPolicy,
  nodeSelect,
  sourceSelect,
  userSelect,
  decimal,
  providerValues,
  credentialProof,
  type CreationNode as Node,
  type CreationProviders as Providers,
  type ChannelCreationGuard as Guard,
  type ChannelCreatePreparation,
  type ChannelCreateProviderPreparation,
} from "./relay-channel-creation-proof";
export type { ChannelCreatePreparation, ChannelCreateProviderPreparation } from "./relay-channel-creation-proof";
/** Complete reference admission, canonical validation, creation and response share one commit boundary. */
export class RelayChannelCreateRepository {
  private static instance: RelayChannelCreateRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelCreateRepository());
  }
  async create<T>(
    id: string,
    input: CreateRelayChannelRequest,
    targets: Providers | undefined,
    guard: Guard,
    persist: boolean,
    prepare: ChannelCreatePreparation,
    prepareProvider: ChannelCreateProviderPreparation,
    project: (tx: Prisma.TransactionClient) => Promise<{ value: T; verify: () => Promise<void> }>,
    audit: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const userIds = [
            ...new Set([...guard.snapshot.users.map((row) => row.id), ...(targets ?? []).map((row) => row.user.id)]),
          ].sort();
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(userIds)}) ORDER BY id FOR UPDATE`,
          );
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
          const readUsers = () =>
            tx.user.findMany({ where: { id: { in: userIds } }, select: userSelect, orderBy: { id: "asc" } });
          const users = await readUsers();
          if (
            users.length !== userIds.length ||
            targets?.some(
              (target) =>
                !same(
                  target.user,
                  users.find((user) => user.id === target.user.id),
                ),
            )
          )
            throw iamAccountDenied();
          await guard.admit(
            [],
            (targets ?? []).map((row) => row.user.id),
          );
          const readNodes = (ids: readonly string[]) =>
            tx.relayChannel.findMany({
              where: { id: { in: [...ids] }, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
              select: nodeSelect,
              orderBy: { id: "asc" },
            });
          const modes = new Map<string, number>(),
            expanded = new Map<string, number>(),
            nodes = new Map<string, Node>();
          const need = (key: string, mode: number) => {
            if (key === id) throw iamAccountDenied();
            modes.set(key, Math.max(modes.get(key) ?? -1, mode));
          };
          if (input.pooledParentId) need(input.pooledParentId, 0);
          for (const edge of input.poolMembers ?? []) need(edge.memberChannelId, 1);
          let pending = [...modes.keys()];
          while (pending.length) {
            if (
              modes.size + 1 >
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
                [row.poolMembers.length, row.pooledChildren.length].some(
                  (count) => count > RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes,
                )
              )
                throw iamAccountDenied();
              nodes.set(row.id, row);
              expanded.set(row.id, modes.get(row.id)!);
              if (!modes.get(row.id)) continue;
              if (row.pooledParentId) need(row.pooledParentId, 0);
              for (const edge of row.poolMembers) need(edge.memberChannelId, 1);
              if (row.channelType === "pooled") for (const child of row.pooledChildren) need(child.id, 1);
            }
            pending = [...modes.keys()].filter((key) => !nodes.has(key) || modes.get(key)! > expanded.get(key)!);
          }
          const graphIds = [...nodes.keys()].sort(),
            graph = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
          if (graphIds.length)
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM relay_channels WHERE id IN (${Prisma.join(graphIds)}) ORDER BY id FOR UPDATE`,
            );
          if (!same(graph, await readNodes(graphIds))) throw iamAccountDenied();
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
            topology = await readTopology();
          if (topology.length !== 1 || !["legacy", "strict-two-tier"].includes(topology[0]!.channelTopologyMode))
            throw iamAccountDenied();
          const topologyMode = topology[0]!.channelTopologyMode as "legacy" | "strict-two-tier";
          const prepared = await prepare(input, catalog, topologyMode),
            data = prepared.data;
          if (
            data.name !== input.name ||
            !["standalone", "pooled-member", "pooled", "automatic-proxy-pool"].includes(data.channelType ?? "")
          )
            throw iamAccountDenied();
          if (
            data.channelType === "pooled-member" &&
            (!data.pooledParentId || nodes.get(data.pooledParentId)?.channelType !== "pooled")
          )
            throw new BadRequestError("Invalid physical channel parent", undefined, {
              messageKey: "relay.pooledParentInvalid",
            });
          const members =
            ["pooled", "automatic-proxy-pool"].includes(data.channelType!) &&
            !(data.channelType === "pooled" && topologyMode === "strict-two-tier")
              ? (prepared.members ?? [])
              : [];
          if (
            data.channelType === "automatic-proxy-pool" &&
            members.some(
              (edge) => !["standalone", "pooled"].includes(nodes.get(edge.memberChannelId)?.channelType ?? ""),
            )
          )
            throw new BadRequestError("Invalid automatic pool member type", undefined, {
              messageKey: "relay.automaticPoolMembersMustBePooledOrStandalone",
            });
          assertRelayChannelGraph([id], (key) => {
            if (key === id) return members.map((edge) => edge.memberChannelId);
            const node = nodes.get(key);
            if (!node) throw iamAccountDenied();
            if (!modes.get(key) || !["pooled", "automatic-proxy-pool"].includes(node.channelType)) return [];
            return [
              ...new Set([
                ...node.poolMembers.map((edge) => edge.memberChannelId),
                ...(node.channelType === "pooled" ? node.pooledChildren.map((child) => child.id) : []),
              ]),
            ];
          });
          const nameMatches = () =>
            tx.relayChannel.findMany({
              where: { name: input.name, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
              select: { id: true },
              orderBy: { id: "asc" },
            });
          if ((await nameMatches()).length)
            throw new ConflictError("Channel name is unavailable", undefined, {
              messageKey: "relayChannel.nameExists",
            });
          if (await tx.relayChannel.findUnique({ where: { id }, select: { id: true } })) throw iamAccountDenied();
          const verifyInputs = async () => {
            if (
              !same(users, await readUsers()) ||
              !same(catalog, await readCatalog()) ||
              !same(topology, await readTopology()) ||
              (await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision
            )
              throw iamAccountDenied();
          };
          await guard.recheck(tx);
          await verifyInputs();
          if (!same(graph, await readNodes(graphIds))) throw iamAccountDenied();
          if (!persist) return undefined;
          const created = await tx.relayChannel.create({
            data: {
              ...data,
              id,
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
          if (created.id !== id) throw iamAccountDenied();
          if (members.length) await RelayChannelRepository.getInstance().replaceMembersByChannelId(id, members, tx);
          const now = new Date(),
            expectedProviders = (targets ?? []).map((target) =>
              providerValues(prepareProvider(target.input, target.user.id, now)),
            );
          if (expectedProviders.some((row, index) => row.userId !== targets![index]!.user.id)) throw iamAccountDenied();
          if (expectedProviders.length)
            await RelayChannelRepository.getInstance().replaceProvidersByChannelId(
              id,
              expectedProviders.map((row) => ({
                ...row,
                settlementIntervalDays: row.settlementIntervalDays ?? undefined,
                settlementTime: row.settlementTime ?? undefined,
              })),
              tx,
            );
          const read = () => tx.relayChannel.findUnique({ where: { id }, select: sourceSelect });
          const source = await read();
          if (
            !source ||
            source.id !== id ||
            source.status !== RELAY_CHANNEL_STATUS.ENABLED ||
            !source.providerServiceEnabled ||
            source.submissionStatus !== "approved" ||
            source.submittedByUserId !== null ||
            source.reviewedByUserId !== null ||
            source.reviewedAt !== null ||
            source.reviewReason !== null
          )
            throw iamAccountDenied();
          for (const [key, expected] of Object.entries(data)) {
            if (expected === undefined || key.endsWith("UpstreamApiKey")) continue;
            if (!Object.hasOwn(source, key)) throw iamAccountDenied();
            const actual = source[key as keyof typeof source];
            if (
              actual instanceof Prisma.Decimal
                ? !actual.equals(decimal(expected as Prisma.Decimal.Value))
                : !same(actual, expected === Prisma.JsonNull || expected === Prisma.DbNull ? null : expected)
            )
              throw iamAccountDenied();
          }
          const edgeValues = (
            edges: readonly {
              memberChannelId: string;
              priority: number;
              weight?: number | Prisma.Decimal;
              enabled?: boolean;
            }[],
          ) =>
            edges
              .map((row) => ({
                memberChannelId: row.memberChannelId,
                priority: row.priority,
                weight: Number(decimal(row.weight ?? 1)),
                enabled: row.enabled !== false,
              }))
              .sort((a, b) => a.memberChannelId.localeCompare(b.memberChannelId));
          if (
            !same(edgeValues(source.poolMembers), edgeValues(members)) ||
            !same(source.providers.filter((row) => row.status === 1).map(providerValues), expectedProviders) ||
            source.providers.length !== expectedProviders.length ||
            source.providers.some((row) => row.lastSettledAt !== null)
          )
            throw iamAccountDenied();
          const verifyGraph = async () => {
            const current = await readNodes(graphIds);
            const expected = graph.map((node) => ({
              ...node,
              pooledChildren: [...node.pooledChildren, ...(data.pooledParentId === node.id ? [{ id }] : [])].sort(
                (a, b) => a.id.localeCompare(b.id),
              ),
            }));
            if (
              !same(current, expected) ||
              (await tx.relayChannel.count({ where: { pooledParentId: id } })) ||
              (await tx.relayChannelMember.count({ where: { memberChannelId: id } }))
            )
              throw iamAccountDenied();
          };
          await credentialProof(tx, id, data);
          await verifyGraph();
          const response = await project(tx);
          const verify = async () => {
            await verifyInputs();
            await response.verify();
            await verifyGraph();
            await credentialProof(tx, id, data);
            if (!same(source, await read()) || !same(await nameMatches(), [{ id }])) throw iamAccountDenied();
          };
          await verify();
          await guard.recheck(tx);
          await audit(tx);
          await guard.recheck(tx);
          await verify();
          return response.value;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: creationPolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028", "P2002"].includes(error.code))
        throw new ConflictError("Channel creation context changed", undefined, { messageKey: "errors.conflict" });
      if (error instanceof ApiError) throw error;
      throw new InternalServerError("Channel creation failed", undefined, { messageKey: "errors.internalServerError" });
    }
  }
}

import { isDeepStrictEqual as same } from "node:util";
import { Prisma } from "@prisma/client";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { RELAY_CHANNEL_STATUS, VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { RELAY_CAPABILITY_RESOLUTION_LIMITS } from "@/constant/relay-capability";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { assertRelayChannelGraph } from "@/util/relay-channel-graph";
import { ApiError, BadRequestError, ConflictError, InternalServerError } from "@/util/errors";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { RelayChannelRepository } from "./relay-channel.repository";
import {
  nodeSelect,
  sourceSelect,
  userSelect,
  decimal,
  providerValues,
  credentialProof,
  type CreationNode,
  type CreationProviders,
  type ChannelCreationGuard,
  type ChannelCreatePreparation,
  type ChannelCreateProviderPreparation,
} from "./relay-channel-creation-proof";
import type {
  RelayChannelImportItemDto,
  CreateRelayChannelRequest,
  RelayChannelMemberDto,
} from "@/api/dto/relay/relay-channel.dto";
const importPolicy = Object.freeze({ timeoutMs: 60000 });
export interface ChannelImportTarget {
  id: string;
  input: RelayChannelImportItemDto;
  providers?: CreationProviders;
}
type ImportGuard = Omit<ChannelCreationGuard, "admit"> & {
  admitReferences: (ids: readonly string[]) => Promise<void>;
  admitProviders: (id: string, users: readonly string[]) => Promise<void>;
};
const edgeValues = (
  edges: readonly { memberChannelId: string; priority: number; weight?: number | Prisma.Decimal; enabled?: boolean }[],
) =>
  edges
    .map((row) => ({
      memberChannelId: row.memberChannelId,
      priority: row.priority,
      weight: Number(decimal(row.weight ?? 1)),
      enabled: row.enabled !== false,
    }))
    .sort((a, b) => a.memberChannelId.localeCompare(b.memberChannelId));
/** Reserves the complete destination set and commits data, graph, providers, response and audit atomically. */
export class RelayChannelImportRepository {
  private static instance: RelayChannelImportRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelImportRepository());
  }
  async import<T>(
    targets: readonly ChannelImportTarget[],
    guard: ImportGuard,
    persist: boolean,
    prepare: ChannelCreatePreparation,
    prepareProvider: ChannelCreateProviderPreparation,
    copyName: (name: string, reserved: Set<string>) => string,
    project: (tx: Prisma.TransactionClient) => Promise<{ value: T; verify: () => Promise<void> }>,
    audit: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const ids = targets.map((row) => row.id),
            destinations = new Set(ids),
            remap = new Map(targets.filter((row) => row.input.id).map((row) => [row.input.id!, row.id]));
          if (
            !ids.length ||
            destinations.size !== ids.length ||
            ids.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
            (remap.size && remap.size !== ids.length)
          )
            throw iamAccountDenied();
          const userIds = [
            ...new Set([
              ...guard.snapshot.users.map((row) => row.id),
              ...targets.flatMap((row) => (row.providers ?? []).map((provider) => provider.user.id)),
            ]),
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
            targets.some((target) =>
              target.providers?.some(
                (provider) =>
                  !same(
                    provider.user,
                    users.find((user) => user.id === provider.user.id),
                  ),
              ),
            )
          )
            throw iamAccountDenied();
          for (const target of targets)
            if (target.providers?.length)
              await guard.admitProviders(
                target.id,
                (target.providers ?? []).map((row) => row.user.id),
              );
          if (await tx.relayChannel.count({ where: { id: { in: ids } } })) throw iamAccountDenied();
          const nameLookups: { name: string; rows: { id: string; name: string }[] }[] = [];
          const lookupName = (name: string) =>
            tx.relayChannel.findMany({
              where: { name, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
              select: { id: true, name: true },
              orderBy: { id: "asc" },
            });
          const resolveMember = async (member: RelayChannelMemberDto) => {
            const internal = remap.get(member.memberChannelId);
            if (internal) return { ...member, memberChannelId: internal };
            if (!member.memberChannelName) return member;
            const rows = await lookupName(member.memberChannelName);
            if (rows.length > 1) throw iamAccountDenied();
            nameLookups.push({ name: member.memberChannelName, rows });
            const batch = targets.filter((target) => target.input.name === member.memberChannelName);
            if (!rows.length && batch.length > 1) throw iamAccountDenied();
            return { ...member, memberChannelId: rows[0]?.id ?? batch[0]?.id ?? member.memberChannelId };
          };
          const inputs: CreateRelayChannelRequest[] = [];
          for (const target of targets)
            inputs.push({
              ...target.input,
              pooledParentId: target.input.pooledParentId
                ? (remap.get(target.input.pooledParentId) ?? target.input.pooledParentId)
                : target.input.pooledParentId,
              poolMembers: target.input.poolMembers
                ? await Promise.all(target.input.poolMembers.map(resolveMember))
                : target.input.poolMembers,
            });
          const readNodes = (keys: readonly string[]) =>
            tx.relayChannel.findMany({
              where: { id: { in: [...keys] }, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
              select: nodeSelect,
              orderBy: { id: "asc" },
            });
          const modes = new Map<string, number>(),
            expanded = new Map<string, number>(),
            nodes = new Map<string, CreationNode>();
          const need = (key: string, mode: number) => {
            if (!destinations.has(key)) modes.set(key, Math.max(modes.get(key) ?? -1, mode));
          };
          for (const input of inputs) {
            if (input.pooledParentId) need(input.pooledParentId, 0);
            for (const edge of input.poolMembers ?? []) need(edge.memberChannelId, 1);
          }
          let pending = [...modes.keys()];
          while (pending.length) {
            if (
              modes.size + ids.length >
              Math.min(IAM_AUTHORIZATION_LIMITS.resourcesPerRequest, RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes)
            )
              throw iamAccountDenied();
            await guard.admitReferences(pending);
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
          const prepared: {
            id: string;
            data: Prisma.RelayChannelUncheckedCreateInput;
            members: RelayChannelMemberDto[];
            providers: ReturnType<typeof providerValues>[];
          }[] = [];
          const now = new Date();
          for (let index = 0; index < targets.length; index++) {
            const target = targets[index]!,
              input = inputs[index]!,
              result = await prepare(input, catalog, topologyMode);
            if (
              result.data.name !== input.name ||
              !["standalone", "pooled-member", "pooled", "automatic-proxy-pool"].includes(result.data.channelType ?? "")
            )
              throw iamAccountDenied();
            prepared.push({
              id: target.id,
              data: result.data,
              members:
                ["pooled", "automatic-proxy-pool"].includes(result.data.channelType!) &&
                !(result.data.channelType === "pooled" && topologyMode === "strict-two-tier")
                  ? (result.members ?? [])
                  : [],
              providers: (target.providers ?? []).map((provider) =>
                providerValues(prepareProvider(provider.input, provider.user.id, now)),
              ),
            });
            if (prepared[index]!.providers.some((row, offset) => row.userId !== target.providers![offset]!.user.id))
              throw iamAccountDenied();
          }
          const byId = new Map(prepared.map((row) => [row.id, row]));
          const typeOf = (id: string) => byId.get(id)?.data.channelType ?? nodes.get(id)?.channelType;
          for (const row of prepared) {
            if (
              row.data.channelType === "pooled-member" &&
              (!row.data.pooledParentId || typeOf(row.data.pooledParentId) !== "pooled")
            )
              throw new BadRequestError("Invalid imported physical parent", undefined, {
                messageKey: "relay.pooledParentInvalid",
              });
            if (
              row.data.channelType === "automatic-proxy-pool" &&
              row.members.some((edge) => !["standalone", "pooled"].includes(typeOf(edge.memberChannelId) ?? ""))
            )
              throw new BadRequestError("Invalid imported automatic pool member", undefined, {
                messageKey: "relay.automaticPoolMembersMustBePooledOrStandalone",
              });
          }
          const children = (id: string) =>
            prepared.filter((row) => row.data.pooledParentId === id).map((row) => row.id);
          assertRelayChannelGraph(ids, (key) => {
            const row = byId.get(key);
            if (row) return [...new Set([...row.members.map((edge) => edge.memberChannelId), ...children(key)])];
            const node = nodes.get(key);
            if (!node) throw iamAccountDenied();
            if (!modes.get(key) || !["pooled", "automatic-proxy-pool"].includes(node.channelType)) return [];
            return [
              ...new Set([
                ...node.poolMembers.map((edge) => edge.memberChannelId),
                ...(node.channelType === "pooled"
                  ? [...node.pooledChildren.map((child) => child.id), ...children(key)]
                  : []),
              ]),
            ];
          });
          const verifyInputs = async () => {
            if (
              !same(users, await readUsers()) ||
              !same(catalog, await readCatalog()) ||
              !same(topology, await readTopology()) ||
              (await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision
            )
              throw iamAccountDenied();
            for (const lookup of nameLookups)
              if (
                !same(
                  lookup.rows,
                  (await lookupName(lookup.name)).filter((row) => !destinations.has(row.id)),
                )
              )
                throw iamAccountDenied();
          };
          await guard.recheck(tx);
          await verifyInputs();
          if (!same(graph, await readNodes(graphIds))) throw iamAccountDenied();
          if (!persist) return undefined;
          const reserved = new Set<string>();
          // First pass: create parents before physical children, but never change caller response order.
          const ordered = [...prepared].sort(
            (a, b) => Number(a.data.channelType === "pooled-member") - Number(b.data.channelType === "pooled-member"),
          );
          for (const row of ordered) {
            const base = row.data.name;
            let name = reserved.has(base) ? copyName(base, reserved) : base;
            while ((await lookupName(name)).length) {
              reserved.add(name);
              name = copyName(base, reserved);
            }
            reserved.add(name);
            row.data.name = name;
            const index = ids.indexOf(row.id);
            await tx.relayChannel.create({
              data: {
                ...row.data,
                id: row.id,
                status:
                  targets[index]!.input.enabled === false
                    ? RELAY_CHANNEL_STATUS.DISABLED
                    : RELAY_CHANNEL_STATUS.ENABLED,
                providerServiceEnabled: true,
                submissionStatus: "approved",
                submittedByUserId: null,
                reviewedByUserId: null,
                reviewedAt: null,
                reviewReason: null,
              },
              select: { id: true },
            });
          }
          // Second pass: every referenced destination exists, including forward pool references.
          for (const row of prepared) {
            if (row.members.length)
              await RelayChannelRepository.getInstance().replaceMembersByChannelId(row.id, row.members, tx);
            if (row.providers.length)
              await RelayChannelRepository.getInstance().replaceProvidersByChannelId(
                row.id,
                row.providers.map((provider) => ({
                  ...provider,
                  settlementIntervalDays: provider.settlementIntervalDays ?? undefined,
                  settlementTime: provider.settlementTime ?? undefined,
                })),
                tx,
              );
          }
          const readCreated = () =>
              tx.relayChannel.findMany({ where: { id: { in: ids } }, select: sourceSelect, orderBy: { id: "asc" } }),
            created = await readCreated();
          if (created.length !== ids.length) throw iamAccountDenied();
          for (const row of prepared) {
            const source = created.find((source) => source.id === row.id)!,
              index = ids.indexOf(row.id);
            if (
              source.status !==
                (targets[index]!.input.enabled === false
                  ? RELAY_CHANNEL_STATUS.DISABLED
                  : RELAY_CHANNEL_STATUS.ENABLED) ||
              !source.providerServiceEnabled ||
              source.submissionStatus !== "approved" ||
              source.submittedByUserId !== null ||
              source.reviewedByUserId !== null ||
              source.reviewedAt !== null ||
              source.reviewReason !== null
            )
              throw iamAccountDenied();
            for (const [key, expected] of Object.entries(row.data)) {
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
            if (
              !same(edgeValues(source.poolMembers), edgeValues(row.members)) ||
              !same(source.providers.filter((provider) => provider.status === 1).map(providerValues), row.providers) ||
              source.providers.length !== row.providers.length ||
              source.providers.some((provider) => provider.lastSettledAt !== null)
            )
              throw iamAccountDenied();
          }
          const verifyGraph = async () => {
            const expected = graph.map((node) => ({
              ...node,
              pooledChildren: [...node.pooledChildren, ...children(node.id).map((id) => ({ id }))].sort((a, b) =>
                a.id.localeCompare(b.id),
              ),
            }));
            if (!same(expected, await readNodes(graphIds))) throw iamAccountDenied();
            const actualChildren = await tx.relayChannel.findMany({
              where: { pooledParentId: { in: ids } },
              select: { id: true, pooledParentId: true },
              orderBy: { id: "asc" },
            });
            const expectedChildren = prepared
              .filter((row) => row.data.pooledParentId && destinations.has(row.data.pooledParentId))
              .map((row) => ({ id: row.id, pooledParentId: row.data.pooledParentId! }))
              .sort((a, b) => a.id.localeCompare(b.id));
            const incoming = await tx.relayChannelMember.findMany({
                where: { memberChannelId: { in: ids } },
                select: { relayChannelId: true, memberChannelId: true },
                orderBy: [{ relayChannelId: "asc" }, { memberChannelId: "asc" }],
              }),
              expectedIncoming = prepared
                .flatMap((row) =>
                  row.members
                    .filter((edge) => destinations.has(edge.memberChannelId))
                    .map((edge) => ({ relayChannelId: row.id, memberChannelId: edge.memberChannelId })),
                )
                .sort(
                  (a, b) =>
                    a.relayChannelId.localeCompare(b.relayChannelId) ||
                    a.memberChannelId.localeCompare(b.memberChannelId),
                );
            if (!same(actualChildren, expectedChildren) || !same(incoming, expectedIncoming)) throw iamAccountDenied();
          };
          for (const row of prepared) await credentialProof(tx, row.id, row.data);
          await verifyGraph();
          const response = await project(tx);
          const verify = async () => {
            await verifyInputs();
            await response.verify();
            await verifyGraph();
            if (!same(created, await readCreated())) throw iamAccountDenied();
            for (const row of prepared) {
              await credentialProof(tx, row.id, row.data);
              if (!same(await lookupName(row.data.name), [{ id: row.id, name: row.data.name }]))
                throw iamAccountDenied();
            }
          };
          await verify();
          await guard.recheck(tx);
          await audit(tx);
          await guard.recheck(tx);
          await verify();
          return response.value;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: importPolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028", "P2002"].includes(error.code))
        throw new ConflictError("Channel import context changed", undefined, { messageKey: "errors.conflict" });
      if (error instanceof ApiError) throw error;
      throw new InternalServerError("Channel import failed", undefined, { messageKey: "errors.internalServerError" });
    }
  }
}

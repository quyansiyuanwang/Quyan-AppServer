import { RELAY_TOKEN_ROUTING_LIMITS } from "@/constant/relay-token";
import { RELAY_COMPOSITION_POLICY } from "@/util/relay/relay-composition.util";
import { parseLegacyPermissions } from "@/iam/legacy-policy";
import { Prisma } from "@prisma/client";
import { Permission, getOAuthScopeAliases, toCanonicalCredential } from "@quyan/shared";
import { RELAY_CHANNEL_STATUS } from "@/constant/relay-channel";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { captureIamOAuthRevision } from "../users/iam-oauth-authority";
import type { RelayTokenAuthorityIdentity } from "./relay-token-authority";
import type { RelayTokenUpdateInput } from "./relay-token.store";
import { RelayCompositionRepository } from "./relay-composition.repository";
import { validateRelayComposition, type RelayCompositionNode } from "@/util/relay/relay-composition.util";
import { generateRelayTokenValue } from "@/util/relay/relay-token-credential.util";
import { RelayTokenCapabilityRepository } from "./relay-token-capability.repository";
import { BadRequestError } from "@/util/errors";
const selection = {
  id: true,
  userId: true,
  status: true,
  updateTime: true,
  routingMode: true,
  channelId: true,
  isCustomKey: true,
  automaticProxyPoolChannelId: true,
  blockedAutomaticProxyPoolChannelIds: true,
  channelConfigs: {
    select: { channelId: true, priority: true },
    orderBy: { priority: "asc" },
    take: RELAY_TOKEN_ROUTING_LIMITS.channels + 1,
  },
  memberTokenConfigs: {
    select: { tokenId: true, priority: true, enabled: true },
    orderBy: { priority: "asc" },
    take: RELAY_COMPOSITION_POLICY.maxMembers + 1,
  },
} as const satisfies Prisma.RelayTokenSelect;
export type RelayTokenUpdateSource = Prisma.RelayTokenGetPayload<{ select: typeof selection }>;
export type RelayTokenConfigurationSource = Omit<RelayTokenUpdateSource, "updateTime">;
export type RelayTokenRoutingSource = Omit<RelayTokenConfigurationSource, "isCustomKey">;
const ordered = <T extends { priority: number }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => a.priority - b.priority);
// Compare explicit fields, not caller object-key order or a synthetic creation timestamp.
const configuration = (row: RelayTokenConfigurationSource) =>
  JSON.stringify([
    row.id,
    row.userId,
    row.status,
    row.routingMode,
    row.channelId,
    row.isCustomKey,
    row.automaticProxyPoolChannelId,
    row.blockedAutomaticProxyPoolChannelIds,
    ordered(row.channelConfigs).map(({ channelId, priority }) => [channelId, priority]),
    ordered(row.memberTokenConfigs).map(({ tokenId, priority, enabled }) => [tokenId, priority, enabled]),
  ]);
/** Credential-free source, graph and quota proofs. All calls consume the caller's transaction. */
export class RelayTokenUpdateAdmissionRepository {
  private static instance: RelayTokenUpdateAdmissionRepository;
  static getInstance() {
    return (this.instance ??= new RelayTokenUpdateAdmissionRepository());
  }
  async source(tx: Prisma.TransactionClient, userId: string, id: string) {
    const row = await tx.relayToken.findFirst({ where: { id, userId, status: { in: [0, 1] } }, select: selection });
    if (
      !row ||
      row.id !== id ||
      row.userId !== userId ||
      row.channelConfigs.length > RELAY_TOKEN_ROUTING_LIMITS.channels ||
      row.memberTokenConfigs.length > RELAY_COMPOSITION_POLICY.maxMembers
    )
      throw iamAccountDenied();
    return row;
  }
  async verify(
    tx: Prisma.TransactionClient,
    source: RelayTokenUpdateSource,
    update: RelayTokenUpdateInput,
    persisted: boolean,
  ) {
    const current = await this.source(tx, source.userId, source.id);
    if (!persisted) {
      if (JSON.stringify(current) !== JSON.stringify(source)) throw iamAccountDenied();
      return;
    }
    const expected = {
      ...source,
      routingMode: update.routingMode ?? source.routingMode,
      channelId: update.channelId === undefined ? source.channelId : update.channelId,
      isCustomKey: update.isCustomKey ?? source.isCustomKey,
      automaticProxyPoolChannelId:
        update.automaticProxyPoolChannelId === undefined
          ? source.automaticProxyPoolChannelId
          : update.automaticProxyPoolChannelId,
      blockedAutomaticProxyPoolChannelIds:
        update.blockedAutomaticProxyPoolChannelIds ?? source.blockedAutomaticProxyPoolChannelIds,
      channelConfigs: update.channelConfigs === undefined ? source.channelConfigs : ordered(update.channelConfigs),
      memberTokenConfigs:
        update.memberTokenConfigs === undefined ? source.memberTokenConfigs : ordered(update.memberTokenConfigs),
    };
    if (configuration(current) !== configuration(expected)) throw iamAccountDenied();
  }
  async verifyCreated(tx: Prisma.TransactionClient, expected: RelayTokenConfigurationSource) {
    if (configuration(await this.source(tx, expected.userId, expected.id)) !== configuration(expected))
      throw iamAccountDenied();
  }
  async pool(tx: Prisma.TransactionClient, id: string) {
    if (!isRelayTokenResourceId(id)) throw iamAccountDenied();
    const proof = await RelayTokenCapabilityRepository.getInstance().channels([id], tx);
    const root = proof.graph.get(id);
    if (
      !root ||
      root.channelType !== "automatic-proxy-pool" ||
      root.status !== RELAY_CHANNEL_STATUS.ENABLED ||
      root.providerServiceEnabled === false
    )
      throw iamAccountDenied();
    return { id, ...proof };
  }
  blocked(
    pool: { id: string; paths: readonly { routingChannelIds: readonly string[] }[] },
    ids: readonly string[] | undefined,
  ) {
    const normalized = [...new Set((ids ?? []).map((id) => id.trim()).filter(Boolean))];
    const reachable = new Set(pool.paths.flatMap((path) => path.routingChannelIds).filter((id) => id !== pool.id));
    if (normalized.some((id) => !isRelayTokenResourceId(id) || !reachable.has(id)))
      throw new BadRequestError("Blocked pool references must be enabled members", undefined, {
        messageKey: "relayToken.blockedChannelsMustBePoolMembers",
      });
    if (!pool.paths.some((path) => path.routingChannelIds.every((id) => !normalized.includes(id))))
      throw new BadRequestError("Automatic pool must retain a usable path", undefined, {
        messageKey: "relayToken.automaticPoolLastChannel",
      });
    return normalized;
  }
  async graph(tx: Prisma.TransactionClient, source: RelayTokenRoutingSource, update: RelayTokenUpdateInput) {
    const nodes = await RelayCompositionRepository.getInstance().getGraph(source.userId, tx);
    const proposed: RelayCompositionNode = {
      id: source.id,
      userId: source.userId,
      status: source.status,
      routingMode: update.routingMode ?? source.routingMode,
      memberTokenConfigs: update.memberTokenConfigs ?? source.memberTokenConfigs,
    };
    const graph = [...nodes.filter((node) => node.id !== source.id), proposed];
    validateRelayComposition(graph);
    const byId = new Map(graph.map((node) => [node.id, node]));
    const reachable = new Set<string>();
    const visit = (id: string) => {
      if (reachable.has(id)) return;
      if (!isRelayTokenResourceId(id) || reachable.size >= IAM_AUTHORIZATION_LIMITS.resourcesPerRequest)
        throw iamAccountDenied();
      const node = byId.get(id);
      if (!node || node.userId !== source.userId || ![0, 1].includes(node.status)) throw iamAccountDenied();
      reachable.add(id);
      if (node.routingMode === "composite") for (const edge of node.memberTokenConfigs) visit(edge.tokenId);
    };
    visit(source.id);
    return graph.filter((node) => reachable.has(node.id)).sort((a, b) => a.id.localeCompare(b.id));
  }
  async customCount(tx: Prisma.TransactionClient, userId: string) {
    return tx.relayToken.count({ where: { userId, isCustomKey: true, status: { in: [0, 1] } } });
  }
  async bypassEligible(tx: Prisma.TransactionClient, identity: RelayTokenAuthorityIdentity) {
    if (!identity.managed) return true;
    const user = await tx.user.findUnique({
      where: { id: identity.principal.subjectUserId },
      select: {
        status: true,
        group: { select: { status: true, accountOwnerId: true, permissions: true } },
      },
    });
    if (!user || user.status !== 1 || !user.group || user.group.status !== 1 || user.group.accountOwnerId !== null)
      throw iamAccountDenied();
    // Optional platform capabilities must be qualified before requesting a platform decision;
    // lack of FREE qualification is not permission to attempt a privileged evaluation.
    return parseLegacyPermissions(user.group.permissions).includes(Permission.RELAY_TOKEN_CUSTOM_KEY_FREE);
  }
  async customScope(tx: Prisma.TransactionClient, identity: RelayTokenAuthorityIdentity, allowFree: boolean) {
    if (!identity.oauth) return { free: allowFree, revision: undefined };
    const row = await tx.oAuthAccessToken.findUnique({
      where: { id: identity.oauth.id },
      select: {
        scopes: true,
        oauthClient: { select: { scopes: true } },
      },
    });
    const contains = (scope: string) =>
      row &&
      [row.scopes, row.oauthClient.scopes].every(
        (values) => Array.isArray(values) && getOAuthScopeAliases(scope).some((alias) => values.includes(alias)),
      );
    const free = Boolean(allowFree && contains(Permission.RELAY_TOKEN_CUSTOM_KEY_FREE));
    const required = free ? Permission.RELAY_TOKEN_CUSTOM_KEY_FREE : Permission.RELAY_TOKEN_CUSTOM_KEY;
    return { free, revision: await captureIamOAuthRevision(identity.principal, identity.oauth, [required], tx) };
  }
  async credential(tx: Prisma.TransactionClient, preferred: string) {
    const normalized = preferred.trim(),
      canonical = toCanonicalCredential(normalized, "relayToken");
    const values = [...new Set([normalized, canonical])];
    const occupied = await tx.relayToken.findFirst({
      where: { OR: [{ token: { in: values } }, { legacyToken: { in: values } }] },
      select: { id: true },
    });
    if (!occupied) return { token: canonical, retainAlias: true };
    let token: string;
    do {
      token = generateRelayTokenValue();
    } while (
      await tx.relayToken.findFirst({ where: { OR: [{ token }, { legacyToken: token }] }, select: { id: true } })
    );
    // Never retain an alias belonging to another credential when falling back to a generated value.
    return { token, retainAlias: false };
  }
}

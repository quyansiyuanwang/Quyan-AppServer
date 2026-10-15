import { Prisma } from "@prisma/client";
import { Permission, getOAuthScopeAliases, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isRelayTokenResourceId, relayTokenArn, platformRelayTokenArn } from "@/iam/resources/relay-token-resources";
import { assertIamAccountPrincipal, iamAccountDenied } from "../users/iam-account-principal";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
const userSelect = { id: true, accountOwnerId: true, groupId: true, status: true, updateTime: true } as const;
export interface RelayTokenReadIdentity {
  principal: IamPrincipal;
  userId: string;
  managed: boolean;
  oauth?: { id: string; clientId: string };
}
export interface RelayTokenReadSnapshot {
  users: Prisma.UserGetPayload<{ select: typeof userSelect }>[];
  group?: { id: string; updateTime: Date };
}
const metadataSelect = {
  id: true,
  userId: true,
  status: true,
  createTime: true,
  updateTime: true,
} as const satisfies Prisma.RelayTokenSelect;
type Target = Prisma.RelayTokenGetPayload<{ select: typeof metadataSelect }>;
/** Safe DTO source. No user password, upstream endpoint/key, legacy token or pool topology is hydrated. */
export const relayTokenReadSelect = {
  ...metadataSelect,
  name: true,
  totalTokens: true,
  requestCount: true,
  usedQuota: true,
  channelId: true,
  routingMode: true,
  automaticProxyPoolChannelId: true,
  blockedAutomaticProxyPoolChannelIds: true,
  expiresAt: true,
  lastUsedAt: true,
  quotaLimit: true,
  allowedModels: true,
  requestFormatTransforms: true,
  normalizerConfig: true,
  contentSafetyConfig: true,
  streamConfig: true,
  ipWhitelist: true,
  modelMapping: true,
  user: { select: { id: true, username: true, name: true } },
  channel: { select: { id: true, name: true, channelType: true } },
  channelConfigs: {
    orderBy: { priority: "asc" },
    select: {
      channelId: true,
      priority: true,
      successCount: true,
      failureCount: true,
      lastUsedAt: true,
      lastSuccessAt: true,
      lastFailureAt: true,
      channel: { select: { id: true, name: true, channelType: true } },
    },
  },
  failoverConfig: {
    select: {
      enabled: true,
      maxRetries: true,
      retryStatusCodes: true,
      failoverThreshold: true,
      failbackCooldownMinutes: true,
      maxAcceptedChannelMultiplier: true,
      minCacheHitRate: true,
    },
  },
  quotaWindows: {
    orderBy: [{ quotaWindowHours: "asc" }, { createTime: "asc" }],
    select: { id: true, quotaWindowHours: true, quotaUnit: true, quotaLimit: true, createTime: true },
  },
  memberTokenConfigs: { orderBy: { priority: "asc" }, select: { tokenId: true, priority: true, enabled: true } },
} as const satisfies Prisma.RelayTokenSelect;
export type RelayTokenReadRecord = Prisma.RelayTokenGetPayload<{ select: typeof relayTokenReadSelect }> & {
  token?: string;
};
export type RelayTokenReadDecision = (action: string, resources: readonly string[]) => Promise<readonly string[]>;
const readPolicy = Object.freeze({ timeoutMs: 30000 });
export class RelayTokenReadRepository {
  private static instance: RelayTokenReadRepository;
  static getInstance() {
    return (this.instance ??= new RelayTokenReadRepository());
  }
  async tokenOwner(id: string) {
    if (!isRelayTokenResourceId(id)) throw iamAccountDenied();
    const row = await prisma.relayToken.findUnique({ where: { id }, select: { id: true, userId: true } });
    if (!row || row.id !== id || !isRelayTokenResourceId(row.userId)) throw iamAccountDenied();
    return row.userId;
  }
  async snapshot(
    identity: RelayTokenReadIdentity,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<RelayTokenReadSnapshot> {
    const { principal, userId, managed, oauth } = identity;
    if (!isRelayTokenResourceId(userId) || managed !== (userId !== principal.subjectUserId)) throw iamAccountDenied();
    await assertIamAccountPrincipal(principal, tx);
    const ids = [...new Set([principal.subjectUserId, principal.accountOwnerId, userId])].sort();
    const users = await tx.user.findMany({
      where: { id: { in: ids }, status: 1 },
      select: userSelect,
      orderBy: { id: "asc" },
    });
    if (users.length !== ids.length || users.some((row, index) => row.id !== ids[index])) throw iamAccountDenied();
    const actor = users.find((row) => row.id === principal.subjectUserId)!;
    if (actor.groupId) {
      const group = await tx.group.findUnique({
        where: { id: actor.groupId },
        select: { status: true, accountOwnerId: true },
      });
      if (!group || group.status !== 1 || (group.accountOwnerId && group.accountOwnerId !== principal.accountOwnerId))
        throw iamAccountDenied();
    }
    const group = managed
      ? await platformManagementGroupSnapshot(principal, Permission.RELAY_TOKEN_MANAGE_OTHERS_READ, tx)
      : undefined;
    if (oauth) {
      const token = await tx.oAuthAccessToken.findUnique({
        where: { id: oauth.id },
        select: {
          userId: true,
          oauthClientId: true,
          status: true,
          revokedAt: true,
          expiresAt: true,
          scopes: true,
          oauthClient: { select: { status: true, reviewStatus: true, scopes: true } },
        },
      });
      const required = [Permission.RELAY_TOKEN_READ, ...(managed ? [Permission.RELAY_TOKEN_MANAGE_OTHERS_READ] : [])];
      const scoped = (scopes: unknown) =>
        Array.isArray(scopes) &&
        required.every((scope) => getOAuthScopeAliases(scope).some((alias) => scopes.includes(alias)));
      if (
        !token ||
        token.userId !== principal.subjectUserId ||
        token.oauthClientId !== oauth.clientId ||
        token.status !== 1 ||
        token.revokedAt ||
        token.expiresAt <= new Date() ||
        !scoped(token.scopes) ||
        token.oauthClient.status !== 1 ||
        token.oauthClient.reviewStatus !== "approved" ||
        !scoped(token.oauthClient.scopes)
      )
        throw iamAccountDenied();
    }
    return { users, ...(group ? { group } : {}) };
  }
  async recheck(
    identity: RelayTokenReadIdentity,
    expected: RelayTokenReadSnapshot,
    tx: Prisma.TransactionClient = prisma,
  ) {
    const current = await this.snapshot(identity, tx);
    if (JSON.stringify(current) !== JSON.stringify(expected)) throw iamAccountDenied();
  }
  async assertTargets(identity: RelayTokenReadIdentity, targets: readonly Target[]) {
    for (let offset = 0; offset < targets.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      const rows = await prisma.relayToken.findMany({
        where: {
          userId: identity.userId,
          OR: batch.map((target) => ({ id: target.id, updateTime: target.updateTime, status: target.status })),
        },
        select: metadataSelect,
      });
      if (
        rows.length !== batch.length ||
        rows.some(
          (row) =>
            !batch.some(
              (target) =>
                target.id === row.id &&
                target.userId === row.userId &&
                target.updateTime.getTime() === row.updateTime.getTime(),
            ),
        )
      )
        throw iamAccountDenied();
    }
  }
  async read(
    identity: RelayTokenReadIdentity,
    expected: RelayTokenReadSnapshot,
    operation: "ListTokens" | "GetToken",
    query: { page: number; pageSize: number; id?: string },
    decide: RelayTokenReadDecision,
    recheck: () => Promise<void>,
    hydrate: boolean,
  ) {
    const { principal, userId, managed } = identity,
      limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    const action =
      "quyan:relay:" + (managed ? (operation === "ListTokens" ? "ListManagedTokens" : "GetManagedToken") : operation);
    const revealAction = "quyan:relay:" + (managed ? "RevealManagedToken" : "RevealToken");
    const arn = (row: { id: string; userId: string }) =>
      managed ? platformRelayTokenArn(row.userId, row.id) : relayTokenArn(principal.accountOwnerId, row.userId, row.id);
    return prisma.$transaction(
      async (tx) => {
        await this.recheck(identity, expected, tx);
        await recheck();
        const revision = await readIamAuthorizationRevision(tx, principal.accountOwnerId),
          evaluations = new Map<string, { action: string; resource: string; decision: string }>();
        const checked = async (operationAction: string, resources: readonly string[]) => {
          if (resources.length > limit) throw iamAccountDenied();
          const outcomes = await decide(operationAction, resources);
          if (
            outcomes.length !== resources.length ||
            outcomes.some((value) => !["Allow", "ExplicitDeny", "ImplicitDeny"].includes(value))
          )
            throw iamAccountDenied();
          resources.forEach((resource, index) => {
            const key = JSON.stringify([operationAction, resource]),
              previous = evaluations.get(key);
            if (previous && previous.decision !== outcomes[index]) throw iamAccountDenied();
            evaluations.set(key, { action: operationAction, resource, decision: outcomes[index]! });
          });
          return outcomes;
        };
        const where = { userId, status: { in: [0, 1] } } satisfies Prisma.RelayTokenWhereInput;
        const admitted: Target[] = [];
        if (operation === "GetToken") {
          if (!query.id || !isRelayTokenResourceId(query.id)) throw iamAccountDenied();
          if ((await checked(action, [arn({ id: query.id, userId })]))[0] !== "Allow") throw iamAccountDenied();
          const row = await tx.relayToken.findFirst({ where: { ...where, id: query.id }, select: metadataSelect });
          if (!row || row.id !== query.id) throw iamAccountDenied();
          admitted.push(row);
        } else {
          let after: string | undefined;
          for (;;) {
            await recheck();
            const rows: Target[] = await tx.relayToken.findMany({
              where: { ...where, ...(after ? { id: { gt: after } } : {}) },
              select: metadataSelect,
              orderBy: { id: "asc" },
              take: limit,
            });
            if (!rows.length) break;
            if (
              rows.some(
                (row, index) =>
                  !isRelayTokenResourceId(row.id) ||
                  row.userId !== userId ||
                  (index ? rows[index - 1]!.id >= row.id : after !== undefined && after >= row.id),
              )
            )
              throw iamAccountDenied();
            const outcomes = await checked(action, rows.map(arn));
            rows.forEach((row, index) => {
              if (outcomes[index] === "Allow") admitted.push(row);
            });
            after = rows[rows.length - 1]!.id;
            if (rows.length < limit) break;
          }
        }
        admitted.sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || b.id.localeCompare(a.id));
        const total = admitted.length,
          totalPages = Math.max(1, Math.ceil(total / query.pageSize)),
          page = Math.min(query.page, totalPages);
        const selected =
          operation === "GetToken" ? admitted : admitted.slice((page - 1) * query.pageSize, page * query.pageSize);
        const records: RelayTokenReadRecord[] = [];
        const contributingTargets: Target[] = [...selected];
        const reveals = selected.length ? await checked(revealAction, selected.map(arn)) : [];
        if (hydrate)
          for (const [index, target] of selected.entries()) {
            await recheck();
            const row = await tx.relayToken.findFirst({
              where: { ...where, id: target.id, updateTime: target.updateTime },
              select: relayTokenReadSelect,
            });
            if (!row || row.id !== target.id || row.userId !== userId) throw iamAccountDenied();
            // Composite member metadata is not a grant to reveal peer token configuration.
            const members = row.memberTokenConfigs;
            if (members.length > limit) throw iamAccountDenied();
            const memberOutcomes = members.length
              ? await checked(
                  action,
                  members.map((member) => arn({ id: member.tokenId, userId })),
                )
              : [];
            const memberIds = members.filter((_, i) => memberOutcomes[i] === "Allow").map((member) => member.tokenId);
            const details = memberIds.length
              ? await tx.relayToken.findMany({
                  where: { ...where, id: { in: memberIds } },
                  select: { ...metadataSelect, name: true, routingMode: true, expiresAt: true },
                })
              : [];
            contributingTargets.push(...details);
            const record = {
              ...row,
              memberTokenConfigs: members
                .filter((member) => details.some((detail) => detail.id === member.tokenId))
                .map((member) => ({ ...member, memberToken: details.find((detail) => detail.id === member.tokenId)! })),
            };
            if (reveals[index] === "Allow") {
              const credential = await tx.relayToken.findFirst({
                where: { ...where, id: target.id, updateTime: target.updateTime },
                select: { id: true, token: true },
              });
              if (!credential || credential.id !== target.id) throw iamAccountDenied();
              records.push({ ...record, token: credential.token });
            } else records.push(record);
          }
        for (const operationAction of new Set([...evaluations.values()].map((value) => value.action))) {
          const entries = [...evaluations.values()].filter((value) => value.action === operationAction);
          for (let offset = 0; offset < entries.length; offset += limit) {
            const batch = entries.slice(offset, offset + limit),
              current = await decide(
                operationAction,
                batch.map((value) => value.resource),
              );
            if (current.length !== batch.length || current.some((value, index) => value !== batch[index]!.decision))
              throw iamAccountDenied();
          }
        }
        await recheck();
        await this.recheck(identity, expected, tx);
        if ((await readIamAuthorizationRevision(tx, principal.accountOwnerId)) !== revision) throw iamAccountDenied();
        return {
          records,
          total,
          page,
          pageSize: query.pageSize,
          targets: [...new Map(contributingTargets.map((target) => [target.id, target])).values()],
          evaluations: [...evaluations.values()],
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: readPolicy.timeoutMs },
    );
  }
}

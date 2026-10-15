import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import {
  isRelayTokenResourceId,
  relayTokenArn,
  platformRelayTokenArn,
  relayTokenReadAction,
  type RelayTokenReadOperation,
} from "@/iam/resources/relay-token-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import {
  captureRelayTokenAuthority,
  RELAY_TOKEN_AUTHORITY_REQUIREMENTS,
  type RelayTokenAuthorityIdentity,
  type RelayTokenAuthoritySnapshot,
} from "./relay-token-authority";
export type RelayTokenReadIdentity = RelayTokenAuthorityIdentity;
export type RelayTokenReadSnapshot = RelayTokenAuthoritySnapshot;
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
  snapshot(identity: RelayTokenReadIdentity, tx: Prisma.TransactionClient = prisma): Promise<RelayTokenReadSnapshot> {
    return captureRelayTokenAuthority(identity, RELAY_TOKEN_AUTHORITY_REQUIREMENTS.read, tx);
  }
  async recheck(
    identity: RelayTokenReadIdentity,
    expected: RelayTokenReadSnapshot,
    tx: Prisma.TransactionClient = prisma,
  ) {
    if (JSON.stringify(await this.snapshot(identity, tx)) !== JSON.stringify(expected)) throw iamAccountDenied();
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
    operation: RelayTokenReadOperation,
    query: { page: number; pageSize: number; id?: string; ids?: string[]; includeDisabled?: boolean },
    decide: RelayTokenReadDecision,
    recheck: () => Promise<void>,
    hydrate: boolean,
  ) {
    const { principal, userId, managed } = identity,
      limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    const action = relayTokenReadAction(operation, managed),
      exporting = operation === "ExportTokens";
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
        const where = {
          userId,
          status: { in: exporting && !query.includeDisabled ? [1] : [0, 1] },
        } satisfies Prisma.RelayTokenWhereInput;
        const admitted: Target[] = [];
        if (exporting && query.ids) {
          if (
            !query.ids.length ||
            query.ids.length > limit ||
            new Set(query.ids).size !== query.ids.length ||
            query.ids.some((id) => !isRelayTokenResourceId(id))
          )
            throw iamAccountDenied();
          const rows = await tx.relayToken.findMany({
            where: { ...where, id: { in: query.ids } },
            select: metadataSelect,
          });
          if (rows.length !== query.ids.length || rows.some((row) => !query.ids!.includes(row.id)))
            throw iamAccountDenied();
          const outcomes = await checked(action, rows.map(arn));
          if (outcomes.some((value) => value !== "Allow")) throw iamAccountDenied();
          admitted.push(...query.ids.map((id) => rows.find((row) => row.id === id)!));
        } else if (operation === "GetToken") {
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
            if (exporting && outcomes.some((value) => value !== "Allow")) throw iamAccountDenied();
            rows.forEach((row, index) => {
              if (outcomes[index] === "Allow") admitted.push(row);
            });
            after = rows[rows.length - 1]!.id;
            if (rows.length < limit) break;
          }
        }
        if (!exporting || !query.ids)
          admitted.sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || b.id.localeCompare(a.id));
        const total = admitted.length,
          totalPages = Math.max(1, Math.ceil(total / query.pageSize)),
          page = Math.min(query.page, totalPages);
        const selected =
          operation !== "ListTokens" ? admitted : admitted.slice((page - 1) * query.pageSize, page * query.pageSize);
        const records: RelayTokenReadRecord[] = [];
        const contributingTargets: Target[] = [...selected];
        const reveals: string[] = [];
        for (let offset = 0; offset < selected.length; offset += limit)
          reveals.push(...(await checked(revealAction, selected.slice(offset, offset + limit).map(arn))));
        if (exporting && reveals.some((value) => value !== "Allow")) throw iamAccountDenied();
        if (hydrate || exporting)
          for (const target of selected) {
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
            if (exporting && memberOutcomes.some((value) => value !== "Allow")) throw iamAccountDenied();
            const memberIds = members.filter((_, i) => memberOutcomes[i] === "Allow").map((member) => member.tokenId);
            const details = memberIds.length
              ? await tx.relayToken.findMany({
                  where: { userId, status: { in: [0, 1] }, id: { in: memberIds } },
                  select: { ...metadataSelect, name: true, routingMode: true, expiresAt: true },
                })
              : [];
            if (exporting && details.length !== memberIds.length) throw iamAccountDenied();
            contributingTargets.push(...details);
            const record = {
              ...row,
              memberTokenConfigs: members
                .filter((member) => details.some((detail) => detail.id === member.tokenId))
                .map((member) => ({ ...member, memberToken: details.find((detail) => detail.id === member.tokenId)! })),
            };
            if (hydrate) records.push(record);
          }
        // Finish metadata/member authorization for the entire selection before loading any credential.
        if (hydrate)
          for (const [index, record] of records.entries()) {
            if (reveals[index] !== "Allow") continue;
            await recheck();
            if (
              (await checked(action, [arn(record)]))[0] !== "Allow" ||
              (await checked(revealAction, [arn(record)]))[0] !== "Allow"
            )
              throw iamAccountDenied();
            const credential = await tx.relayToken.findFirst({
              where: { ...where, id: record.id, updateTime: record.updateTime },
              select: { id: true, token: true },
            });
            if (!credential || credential.id !== record.id) throw iamAccountDenied();
            records[index] = { ...record, token: credential.token };
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

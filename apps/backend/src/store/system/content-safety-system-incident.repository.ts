import { platformSqlRowNumber } from "./platform-sql-row-number";
import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isContentSafetyRuleId } from "@/iam/resources/content-safety-system-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { BadRequestError } from "@/util/errors";
import type { ContentSafetyIncidentQuery, ContentSafetyIncidentSortBy } from "@/api/dto/system/content-safety.dto";
import type { PlatformCollectionCursor } from "./platform-collection.store";
import { CONTENT_SAFETY_INCIDENT_FIELDS } from "./content-safety-incident-view";
import type {
  ContentSafetySystemIncidentStore,
  ContentSafetySystemIncidentWhere,
  ContentSafetySystemIncidentTarget,
} from "./content-safety-system-incident.store";
const sortColumns: Record<ContentSafetyIncidentSortBy, Prisma.Sql> = {
  createTime: Prisma.sql`i.createTime`,
  requestId: Prisma.sql`i.requestId`,
  action: Prisma.sql`i.action`,
  source: Prisma.sql`i.source`,
  statusCode: Prisma.sql`i.statusCode`,
};
const joins = Prisma.sql`LEFT JOIN content_safety_rules r ON r.id=i.ruleId LEFT JOIN relay_tokens t ON t.id=i.relayTokenId LEFT JOIN relay_channels c ON c.id=i.channelId`;
// Digests cover returned incident bodies and contributing relation data, including raw writes without updated timestamps.
const revision = Prisma.sql`SHA2(CAST(JSON_ARRAY(i.id,i.status,i.createTime,i.updateTime,i.userId,i.relayTokenId,i.requestId,i.direction,i.action,i.source,i.ruleId,i.channelId,i.statusCode,i.auditModel,i.auditInputTokens,i.auditOutputTokens,i.auditTotalTokens,i.auditCost,i.auditDurationMs,i.replaced,i.blocked,i.matchContext,i.matchText,r.id,r.status,r.ownerUserId,r.name,r.type,r.pattern,t.id,t.name,c.id,c.name) AS CHAR),256)`;
export class ContentSafetySystemIncidentRepository implements ContentSafetySystemIncidentStore {
  private static instance: ContentSafetySystemIncidentRepository;
  static getInstance() {
    return (this.instance ??= new ContentSafetySystemIncidentRepository());
  }
  async where(query: ContentSafetyIncidentQuery): Promise<ContentSafetySystemIncidentWhere> {
    const conditions: Prisma.Sql[] = [Prisma.sql`i.status=1`];
    const invalid = () =>
      new BadRequestError("Invalid incident filters", undefined, { messageKey: "errors.badRequest" });
    if (query.userId) {
      if (!isContentSafetyRuleId(query.userId)) throw invalid();
      conditions.push(Prisma.sql`i.userId=${query.userId}`);
    }
    if (query.direction) {
      if (!["request", "response"].includes(query.direction)) throw invalid();
      conditions.push(Prisma.sql`i.direction=${query.direction}`);
    }
    if (query.source) {
      if (!["rule", "ai"].includes(query.source)) throw invalid();
      conditions.push(Prisma.sql`i.source=${query.source}`);
    }
    if (query.processingStatus) {
      if (!["blocked", "replaced", "allow"].includes(query.processingStatus)) throw invalid();
      conditions.push(
        query.processingStatus === "blocked"
          ? Prisma.sql`i.blocked=1`
          : query.processingStatus === "replaced"
            ? Prisma.sql`i.replaced=1 AND i.blocked=0`
            : Prisma.sql`i.replaced=0 AND i.blocked=0`,
      );
    }
    for (const [value, column] of [
      [query.requestId, Prisma.sql`i.requestId`],
      [query.relayTokenName, Prisma.sql`t.name`],
      [query.channelName, Prisma.sql`c.name`],
    ] as const) {
      if (
        value !== undefined &&
        (typeof value !== "string" ||
          value.length > 500 ||
          [...value].some((character) => character.charCodeAt(0) < 32))
      )
        throw invalid();
      if (value?.trim()) conditions.push(Prisma.sql`${column} LIKE ${"%" + value.trim() + "%"}`);
    }
    const start = query.startTime ? new Date(query.startTime) : undefined,
      end = query.endTime ? new Date(query.endTime) : undefined;
    if (
      (start && !Number.isFinite(start.getTime())) ||
      (end && !Number.isFinite(end.getTime())) ||
      (start && end && start > end)
    )
      throw invalid();
    if (start) conditions.push(Prisma.sql`i.createTime>=${start}`);
    if (end) conditions.push(Prisma.sql`i.createTime<=${end}`);
    const sort = query.sortBy ?? "createTime",
      order = query.sortOrder ?? "desc";
    if (!Object.hasOwn(sortColumns, sort) || !["asc", "desc"].includes(order)) throw invalid();
    const predicate = Prisma.join(conditions, " AND ");
    // Ranking needs relation lookups only when a relation-name filter is active.
    // Do not repeat revision-only joins for every candidate in the correlated count.
    const rankJoins = Prisma.sql`
      ${query.relayTokenName?.trim() ? Prisma.sql`LEFT JOIN relay_tokens t ON t.id=i.relayTokenId` : Prisma.empty}
      ${query.channelName?.trim() ? Prisma.sql`LEFT JOIN relay_channels c ON c.id=i.channelId` : Prisma.empty}`;
    return {
      predicate,
      rank: platformSqlRowNumber(
        Prisma.sql`SELECT i.id,${sortColumns[sort]} AS sortValue FROM content_safety_incidents i ${rankJoins} WHERE ${predicate}`,
        [
          { column: "sortValue", current: sortColumns[sort], direction: order },
          { column: "id", current: Prisma.sql`i.id`, direction: "desc" },
        ],
      ),
    };
  }
  private async metadata(
    where: ContentSafetySystemIncidentWhere,
    after?: PlatformCollectionCursor,
    boundary?: PlatformCollectionCursor,
    ids?: readonly string[],
  ) {
    const rows = await prisma.$queryRaw<
      (Omit<ContentSafetySystemIncidentTarget, "sortRank"> & { sortRank: bigint })[]
    >(Prisma.sql`
      SELECT * FROM (SELECT i.id,i.status,i.createTime,i.updateTime,i.ruleId,r.ownerUserId AS ruleOwnerUserId,r.status AS ruleStatus,${revision} AS revision,${where.rank} AS sortRank FROM content_safety_incidents i ${joins} WHERE ${where.predicate}) ranked WHERE 1=1
      ${after ? Prisma.sql`AND (createTime<${after.createTime} OR (createTime=${after.createTime} AND id<${after.id}))` : Prisma.empty}
      ${boundary ? Prisma.sql`AND (createTime<${boundary.createTime} OR (createTime=${boundary.createTime} AND id<=${boundary.id}))` : Prisma.empty}
      ${ids ? Prisma.sql`AND id IN (${Prisma.join([...ids])})` : Prisma.empty}
      ORDER BY createTime DESC,id DESC LIMIT ${IAM_AUTHORIZATION_LIMITS.resourcesPerRequest}`);
    return rows.map((row) => ({ ...row, sortRank: Number(row.sortRank) }));
  }
  scan(where: ContentSafetySystemIncidentWhere, after?: PlatformCollectionCursor, boundary?: PlatformCollectionCursor) {
    for (const cursor of [after, boundary])
      if (
        cursor &&
        (!isContentSafetyRuleId(cursor.id) ||
          !(cursor.createTime instanceof Date) ||
          !Number.isFinite(cursor.createTime.getTime()))
      )
        throw iamAccountDenied();
    return this.metadata(where, after, boundary);
  }
  private same(
    actual: readonly ContentSafetySystemIncidentTarget[],
    expected: readonly ContentSafetySystemIncidentTarget[],
  ) {
    if (
      actual.length !== expected.length ||
      actual.some(
        (row) =>
          !expected.some(
            (previous) =>
              previous.id === row.id && previous.revision === row.revision && previous.sortRank === row.sortRank,
          ),
      )
    )
      throw iamAccountDenied();
  }
  async hydrate(
    where: ContentSafetySystemIncidentWhere,
    targets: readonly ContentSafetySystemIncidentTarget[],
    ruleIds: ReadonlySet<string>,
  ) {
    if (!targets.length) return [];
    const ids = targets.map((row) => row.id);
    if (
      ids.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !isContentSafetyRuleId(id)) ||
      [...ruleIds].some(
        (id) => !targets.some((row) => row.ruleId === id && row.ruleOwnerUserId === null && row.ruleStatus === 1),
      )
    )
      throw iamAccountDenied();
    this.same(await this.metadata(where, undefined, undefined, ids), targets);
    const incidents = await prisma.contentSafetyIncident.findMany({
      where: { id: { in: ids }, status: 1 },
      select: { ...CONTENT_SAFETY_INCIDENT_FIELDS, rule: { select: { name: true, type: true } } },
    });
    if (incidents.length !== targets.length) throw iamAccountDenied();
    const [rules, tokens, channels] = await Promise.all([
      ruleIds.size
        ? prisma.contentSafetyRule.findMany({
            where: { id: { in: [...ruleIds] }, status: 1, ownerUserId: null },
            select: { id: true, pattern: true },
          })
        : Promise.resolve([]),
      prisma.relayToken.findMany({
        where: { id: { in: incidents.flatMap((row) => (row.relayTokenId ? [row.relayTokenId] : [])) } },
        select: { id: true, name: true },
      }),
      prisma.relayChannel.findMany({
        where: { id: { in: incidents.flatMap((row) => (row.channelId ? [row.channelId] : [])) } },
        select: { id: true, name: true },
      }),
    ]);
    if (rules.length !== ruleIds.size) throw iamAccountDenied();
    this.same(await this.metadata(where, undefined, undefined, ids), targets);
    return targets.map((target) => {
      const row = incidents.find((incident) => incident.id === target.id)!;
      const pattern = rules.find((rule) => rule.id === row.ruleId)?.pattern;
      return {
        ...row,
        rule: row.rule ? { ...row.rule, ...(pattern !== undefined ? { pattern } : {}) } : null,
        relayTokenName: tokens.find((token) => token.id === row.relayTokenId)?.name ?? null,
        channelName: channels.find((channel) => channel.id === row.channelId)?.name ?? null,
      };
    });
  }
}

import { prisma } from "@/config/database";
import type { ContentSafetyIncident, Prisma } from "@prisma/client";
import type { ContentSafetyIncidentQuery } from "@/api/dto/system/content-safety.dto";

export class ContentSafetyRepository {
  private static instance: ContentSafetyRepository;
  static getInstance() {
    if (!this.instance) this.instance = new ContentSafetyRepository();
    return this.instance;
  }

  listRules(direction?: string) {
    return prisma.contentSafetyRule.findMany({
      where: { status: 1, enabled: true, ...(direction ? { OR: [{ direction }, { direction: "both" }] } : {}) },
      orderBy: [{ priority: "asc" }, { createTime: "asc" }, { id: "asc" }],
    });
  }

  listRulesForUser(userId: string, direction?: string) {
    return prisma.contentSafetyRule.findMany({
      where: {
        status: 1,
        AND: [
          {
            OR: [{ ownerUserId: null, enabled: true }, { ownerUserId: userId }],
          },
          ...(direction ? [{ OR: [{ direction }, { direction: "both" }] }] : []),
        ],
      },
      include: { userOverrides: { where: { userId, status: 1 } } },
      orderBy: [{ priority: "asc" }, { createTime: "asc" }, { id: "asc" }],
    });
  }

  getUserConfig(userId: string) {
    return prisma.contentSafetyUserConfig.findUnique({ where: { userId } });
  }

  upsertUserConfig(userId: string, data: Prisma.ContentSafetyUserConfigUncheckedUpdateInput) {
    return prisma.contentSafetyUserConfig.upsert({
      where: { userId },
      create: data as Prisma.ContentSafetyUserConfigUncheckedCreateInput,
      update: data,
    });
  }

  upsertRuleOverride(userId: string, ruleId: string, enabled: boolean) {
    return prisma.contentSafetyRuleUserOverride.upsert({
      where: { userId_ruleId: { userId, ruleId } },
      create: { userId, ruleId, enabled },
      update: { enabled, status: 1 },
    });
  }

  deleteRuleOverride(userId: string, ruleId: string) {
    return prisma.contentSafetyRuleUserOverride.deleteMany({ where: { userId, ruleId } });
  }

  listAllRules(page = 1, pageSize = 50) {
    const skip = (Math.max(1, page) - 1) * Math.min(100, Math.max(1, pageSize));
    const take = Math.min(100, Math.max(1, pageSize));
    return Promise.all([
      prisma.contentSafetyRule.findMany({
        where: { status: 1 },
        orderBy: [{ priority: "asc" }, { createTime: "desc" }],
        skip,
        take,
      }),
      prisma.contentSafetyRule.count({ where: { status: 1 } }),
    ]).then(([rules, total]) => ({ rules, total }));
  }

  listRulesForExport(ownerUserId?: string) {
    return prisma.contentSafetyRule.findMany({
      where: { status: 1, ...(ownerUserId === undefined ? {} : { OR: [{ ownerUserId: null }, { ownerUserId }] }) },
      orderBy: [{ priority: "asc" }, { createTime: "asc" }, { id: "asc" }],
      include: ownerUserId === undefined ? undefined : { userOverrides: { where: { userId: ownerUserId, status: 1 } } },
    });
  }

  async batchUpdateSystemRules(ids: string[], changes: Prisma.ContentSafetyRuleUncheckedUpdateInput) {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.contentSafetyRule.findMany({
        where: { id: { in: ids }, status: 1, ownerUserId: null },
        select: { id: true },
      });
      if (rows.length !== ids.length) throw new Error("One or more system rules are not editable");
      return tx.contentSafetyRule.updateMany({
        where: { id: { in: ids }, status: 1, ownerUserId: null },
        data: changes,
      });
    });
  }

  async batchUpdateUserRules(
    userId: string,
    ids: string[],
    ruleChanges: Prisma.ContentSafetyRuleUncheckedUpdateInput,
    overrideEnabled?: boolean,
  ) {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.contentSafetyRule.findMany({
        where: { id: { in: ids }, status: 1, OR: [{ ownerUserId: userId }, { ownerUserId: null }] },
        select: { id: true, ownerUserId: true },
      });
      if (rows.length !== ids.length) throw new Error("One or more content safety rules are not accessible");
      let updated = 0;
      const ownedIds = rows.filter((row) => row.ownerUserId === userId).map((row) => row.id);
      const systemIds = rows.filter((row) => row.ownerUserId === null).map((row) => row.id);
      if (ownedIds.length)
        updated += (
          await tx.contentSafetyRule.updateMany({ where: { id: { in: ownedIds }, status: 1 }, data: ruleChanges })
        ).count;
      if (systemIds.length && overrideEnabled !== undefined) {
        for (const ruleId of systemIds) {
          await tx.contentSafetyRuleUserOverride.upsert({
            where: { userId_ruleId: { userId, ruleId } },
            create: { userId, ruleId, enabled: overrideEnabled },
            update: { enabled: overrideEnabled, status: 1 },
          });
          updated += 1;
        }
      }
      if (systemIds.length && overrideEnabled === undefined && Object.keys(ruleChanges).length)
        throw new Error("System rules only support enabled overrides");
      return { count: updated };
    });
  }

  async applySystemRuleImport(
    operations: Array<{
      operation: "create" | "update";
      id?: string;
      data: Prisma.ContentSafetyRuleUncheckedCreateInput;
    }>,
  ) {
    return prisma.$transaction(async (tx) => {
      for (const operation of operations) {
        if (operation.operation === "create") await tx.contentSafetyRule.create({ data: operation.data });
        else {
          if (!operation.id) throw new Error("Missing rule id");
          const { ownerUserId: _ownerUserId, ...updateData } = operation.data;
          await tx.contentSafetyRule.update({ where: { id: operation.id }, data: updateData });
        }
      }
      return { count: operations.length };
    });
  }

  async applyUserRuleImport(
    userId: string,
    operations: Array<{
      operation: "create" | "update";
      id?: string;
      data: Prisma.ContentSafetyRuleUncheckedCreateInput;
    }>,
  ) {
    return prisma.$transaction(async (tx) => {
      for (const operation of operations) {
        if (operation.operation === "create") {
          await tx.contentSafetyRule.create({ data: { ...operation.data, ownerUserId: userId, source: "user" } });
        } else {
          if (!operation.id) throw new Error("Missing rule id");
          const existing = await tx.contentSafetyRule.findFirst({
            where: { id: operation.id, ownerUserId: userId, status: 1 },
          });
          if (!existing) throw new Error("User rule is not editable");
          const { ownerUserId: _ownerUserId, ...updateData } = operation.data;
          await tx.contentSafetyRule.update({ where: { id: operation.id }, data: updateData });
        }
      }
      return { count: operations.length };
    });
  }

  create(data: Prisma.ContentSafetyRuleUncheckedCreateInput) {
    return prisma.contentSafetyRule.create({ data });
  }
  update(id: string, data: Prisma.ContentSafetyRuleUncheckedUpdateInput) {
    return prisma.contentSafetyRule.update({ where: { id }, data });
  }
  async softDelete(id: string) {
    await prisma.contentSafetyRule.update({ where: { id }, data: { status: 0, enabled: false } });
  }
  async findBySourcePattern(source: string, pattern: string) {
    return prisma.contentSafetyRule.findFirst({ where: { source, pattern, status: 1 } });
  }
  async findActiveByPattern(pattern: string) {
    return prisma.contentSafetyRule.findFirst({ where: { pattern, status: 1 } });
  }
  async findActiveByOwnerPattern(ownerUserId: string, pattern: string) {
    return prisma.contentSafetyRule.findFirst({ where: { ownerUserId, pattern, status: 1 } });
  }
  findRuleById(id: string) {
    return prisma.contentSafetyRule.findFirst({ where: { id, status: 1 } });
  }
  async findAdministratorIds() {
    const users = await prisma.user.findMany({
      where: {
        status: { gte: 0 },
        OR: [
          { permissionAdds: { array_contains: "system:config" } },
          { group: { permissions: { array_contains: "system:config" } } },
        ],
      },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }
  async ruleStats() {
    const rows = await prisma.contentSafetyRule.findMany({ where: { status: 1 }, select: { pattern: true } });
    return {
      count: rows.length,
      patternBytes: rows.reduce((total, row) => total + Buffer.byteLength(row.pattern, "utf8"), 0),
    };
  }
  createIncident(data: Prisma.ContentSafetyIncidentUncheckedCreateInput): Promise<ContentSafetyIncident> {
    return prisma.contentSafetyIncident.create({ data });
  }
  async listIncidents(query: ContentSafetyIncidentQuery = {}) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const skip = (Math.max(1, page) - 1) * Math.min(100, Math.max(1, pageSize));
    const take = Math.min(100, Math.max(1, pageSize));
    const tokenName = query.relayTokenName?.trim();
    const channelName = query.channelName?.trim();
    const [tokenIds, channelIds] = await Promise.all([
      tokenName
        ? prisma.relayToken.findMany({ where: { name: { contains: tokenName } }, select: { id: true } })
        : Promise.resolve([]),
      channelName
        ? prisma.relayChannel.findMany({ where: { name: { contains: channelName } }, select: { id: true } })
        : Promise.resolve([]),
    ]);
    const startTime = query.startTime ? new Date(query.startTime) : undefined;
    const endTime = query.endTime ? new Date(query.endTime) : undefined;
    const where: Prisma.ContentSafetyIncidentWhereInput = {
      status: 1,
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.direction ? { direction: query.direction } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.requestId?.trim() ? { requestId: { contains: query.requestId.trim() } } : {}),
      ...(tokenName ? { relayTokenId: { in: tokenIds.map((token) => token.id) } } : {}),
      ...(channelName ? { channelId: { in: channelIds.map((channel) => channel.id) } } : {}),
      ...(query.processingStatus === "blocked" ? { blocked: true } : {}),
      ...(query.processingStatus === "replaced" ? { replaced: true, blocked: false } : {}),
      ...(query.processingStatus === "allow" ? { replaced: false, blocked: false } : {}),
      ...(startTime && !Number.isNaN(startTime.valueOf()) ? { createTime: { gte: startTime } } : {}),
      ...(endTime && !Number.isNaN(endTime.valueOf())
        ? {
            createTime: {
              ...(startTime && !Number.isNaN(startTime.valueOf()) ? { gte: startTime } : {}),
              lte: endTime,
            },
          }
        : {}),
    };
    const sortBy = ["createTime", "requestId", "action", "source", "statusCode"].includes(query.sortBy || "")
      ? query.sortBy!
      : "createTime";
    const sortOrder = query.sortOrder === "asc" ? "asc" : "desc";
    const [incidents, total] = await Promise.all([
      prisma.contentSafetyIncident.findMany({
        where,
        orderBy: [{ [sortBy]: sortOrder }, { id: "desc" }],
        skip,
        take,
        select: {
          id: true,
          createTime: true,
          userId: true,
          relayTokenId: true,
          requestId: true,
          direction: true,
          action: true,
          source: true,
          ruleId: true,
          channelId: true,
          statusCode: true,
          auditModel: true,
          auditInputTokens: true,
          auditOutputTokens: true,
          auditTotalTokens: true,
          auditCost: true,
          auditDurationMs: true,
          replaced: true,
          blocked: true,
          matchContext: true,
          matchText: true,
          rule: { select: { name: true, type: true, pattern: true } },
        },
      }),
      prisma.contentSafetyIncident.count({ where }),
    ]);
    const relayTokenIds = [...new Set(incidents.map((incident) => incident.relayTokenId).filter(Boolean))] as string[];
    const incidentChannelIds = [
      ...new Set(incidents.map((incident) => incident.channelId).filter(Boolean)),
    ] as string[];
    const [tokens, channels] = await Promise.all([
      relayTokenIds.length
        ? prisma.relayToken.findMany({ where: { id: { in: relayTokenIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      incidentChannelIds.length
        ? prisma.relayChannel.findMany({ where: { id: { in: incidentChannelIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ]);
    const tokenNameById = new Map(tokens.map((token) => [token.id, token.name]));
    const channelNameById = new Map(channels.map((channel) => [channel.id, channel.name]));
    return {
      incidents: incidents.map((incident) => ({
        ...incident,
        relayTokenName: incident.relayTokenId ? (tokenNameById.get(incident.relayTokenId) ?? null) : null,
        channelName: incident.channelId ? (channelNameById.get(incident.channelId) ?? null) : null,
      })),
      total,
    };
  }
}

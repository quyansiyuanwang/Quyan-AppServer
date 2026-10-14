import {
  runCarpoolTemplateWrite,
  bindCarpoolTemplateWrite,
  type CarpoolTemplateWriteGuard,
} from "./carpool-template-write";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { prisma } from "@/config/database";
import { Prisma } from "@prisma/client";

export const carpoolOrderInclude = {
  members: {
    include: { user: { select: { username: true } }, reservation: true, relayToken: true, userMonthlyPass: true },
    orderBy: { createTime: "asc" },
  },
  relayChannel: { select: { id: true, name: true } },
  events: { orderBy: { createTime: "asc" } },
} satisfies Prisma.CarpoolOrderInclude;
export type CarpoolOrderRecord = Prisma.CarpoolOrderGetPayload<{ include: typeof carpoolOrderInclude }>;

const memberTargetSelect = {
  id: true,
  createTime: true,
  updateTime: true,
  members: { where: { status: 1 }, select: { userId: true } },
} satisfies Prisma.CarpoolOrderSelect;
export type CarpoolMemberOrderTarget = Prisma.CarpoolOrderGetPayload<{ select: typeof memberTargetSelect }>;

export class CarpoolRepository {
  private static instance: CarpoolRepository;
  static getInstance() {
    return (this.instance ??= new CarpoolRepository());
  }
  withTransaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) {
    return prisma.$transaction(callback, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  findPublishedTemplates() {
    return prisma.carpoolPackageTemplate.findMany({
      where: { status: 1, publishStatus: "published" },
      orderBy: { publishedAt: "desc" },
    });
  }
  findActiveMonthlyPassTemplate(id: string) {
    return prisma.monthlyPassTemplate.findFirst({ where: { id, status: 1 } });
  }
  createTemplate(data: Prisma.CarpoolPackageTemplateUncheckedCreateInput, guard?: CarpoolTemplateWriteGuard) {
    return runCarpoolTemplateWrite(guard, undefined, data, (tx) => tx.carpoolPackageTemplate.create({ data }));
  }
  updateTemplate(
    id: string,
    data: Prisma.CarpoolPackageTemplateUncheckedUpdateInput,
    guard?: CarpoolTemplateWriteGuard,
  ) {
    return runCarpoolTemplateWrite(guard, id, data, (tx) => tx.carpoolPackageTemplate.update({ where: { id }, data }));
  }
  updateTemplatePublication(id: string, published: boolean, guard?: CarpoolTemplateWriteGuard) {
    const data = { publishStatus: published ? "published" : "draft", publishedAt: published ? new Date() : null };
    if (guard) bindCarpoolTemplateWrite(guard, data);
    return runCarpoolTemplateWrite(guard, id, data, (tx) => tx.carpoolPackageTemplate.update({ where: { id }, data }));
  }
  archiveTemplate(id: string, guard?: CarpoolTemplateWriteGuard) {
    const data = { status: -1, publishStatus: "draft", publishedAt: null };
    if (guard) bindCarpoolTemplateWrite(guard, data);
    return runCarpoolTemplateWrite(guard, id, data, (tx) => tx.carpoolPackageTemplate.update({ where: { id }, data }));
  }
  findTemplate(id: string) {
    return prisma.carpoolPackageTemplate.findFirst({ where: { id, status: { gte: 0 } } });
  }
  findPublishedTemplate(id: string) {
    return prisma.carpoolPackageTemplate.findFirst({ where: { id, status: 1, publishStatus: "published" } });
  }
  createInvite(data: Prisma.CarpoolInviteCreateInput) {
    return prisma.carpoolInvite.create({ data });
  }
  findOrderSummary(id: string) {
    return prisma.carpoolOrder.findUnique({ where: { id } });
  }
  findTemplates(page: number, pageSize: number, keyword?: string, publishStatus?: string, publishedOnly = false) {
    const where = {
      status: publishedOnly ? 1 : { gte: 0 },
      ...(publishedOnly ? { publishStatus: "published" } : publishStatus ? { publishStatus } : {}),
      ...(keyword ? { OR: [{ name: { contains: keyword } }, { description: { contains: keyword } }] } : {}),
    } satisfies Prisma.CarpoolPackageTemplateWhereInput;
    return Promise.all([
      prisma.carpoolPackageTemplate.count({ where }),
      prisma.carpoolPackageTemplate.findMany({
        where,
        orderBy: { createTime: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
  }
  private memberOrderWhere(
    userId: string,
    accountOwnerId: string,
    state?: string,
    keyword?: string,
  ): Prisma.CarpoolOrderWhereInput {
    return {
      status: 1,
      members: {
        some: {
          userId,
          status: 1,
          user: { status: 1, OR: [{ id: accountOwnerId, accountOwnerId: null }, { accountOwnerId }] },
        },
      },
      ...(state ? { state } : {}),
      ...(keyword ? { OR: [{ packageName: { contains: keyword } }, { id: { contains: keyword } }] } : {}),
    };
  }
  findMemberOrderTarget(id: string, userId: string, accountOwnerId: string) {
    return prisma.carpoolOrder.findFirst({
      where: { ...this.memberOrderWhere(userId, accountOwnerId), id },
      select: memberTargetSelect,
    });
  }
  scanMemberOrderTargets(
    userId: string,
    accountOwnerId: string,
    state?: string,
    keyword?: string,
    after?: CarpoolMemberOrderTarget,
  ) {
    return prisma.carpoolOrder.findMany({
      where: {
        ...this.memberOrderWhere(userId, accountOwnerId, state, keyword),
        ...(after
          ? {
              AND: [
                {
                  OR: [
                    { createTime: { lt: after.createTime } },
                    { createTime: after.createTime, id: { lt: after.id } },
                  ],
                },
              ],
            }
          : {}),
      },
      select: memberTargetSelect,
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  readMemberOrderTargets(userId: string, accountOwnerId: string, targets: readonly CarpoolMemberOrderTarget[]) {
    if (!targets.length) return Promise.resolve([]);
    return prisma.carpoolOrder.findMany({
      where: {
        ...this.memberOrderWhere(userId, accountOwnerId),
        OR: targets.map((target) => ({ id: target.id, updateTime: target.updateTime })),
      },
      include: carpoolOrderInclude,
    });
  }
  findUsableInviteOrder(tokenHash: string, now: Date) {
    return prisma.carpoolInvite.findFirst({
      where: {
        tokenHash,
        status: 1,
        revokedAt: null,
        usedAt: null,
        expiresAt: { gt: now },
        order: { status: 1, state: "open" },
      },
      select: { orderId: true },
    });
  }
  findOrder(id: string) {
    return prisma.carpoolOrder.findUnique({ where: { id }, include: carpoolOrderInclude });
  }
  findOrdersForUser(userId: string, page: number, pageSize: number, state?: string, keyword?: string) {
    const where = {
      members: { some: { userId } },
      ...(state ? { state } : {}),
      ...(keyword ? { OR: [{ packageName: { contains: keyword } }, { id: { contains: keyword } }] } : {}),
    } satisfies Prisma.CarpoolOrderWhereInput;
    return Promise.all([
      prisma.carpoolOrder.count({ where }),
      prisma.carpoolOrder.findMany({
        where,
        include: carpoolOrderInclude,
        orderBy: { createTime: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
  }
  private adminOrderSearchWhere(keyword?: string) {
    return {
      ...(keyword
        ? {
            OR: [
              { packageName: { contains: keyword } },
              { id: { contains: keyword } },
              { owner: { username: { contains: keyword } } },
            ],
          }
        : {}),
    } satisfies Prisma.CarpoolOrderWhereInput;
  }
  findOrdersForAdmin(state: string | undefined, page: number, pageSize: number, keyword?: string) {
    const where = {
      ...this.adminOrderSearchWhere(keyword),
      ...(state ? { state } : {}),
    } satisfies Prisma.CarpoolOrderWhereInput;
    return Promise.all([
      prisma.carpoolOrder.count({ where }),
      prisma.carpoolOrder.findMany({
        where,
        include: carpoolOrderInclude,
        // Submitted/accepted work has a submitted timestamp; keep it ahead of open orders.
        orderBy: [{ submittedAt: { sort: "asc", nulls: "last" } }, { createTime: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
  }
  countAdminOrdersByState(keyword?: string) {
    return prisma.carpoolOrder.groupBy({
      by: ["state"],
      where: this.adminOrderSearchWhere(keyword),
      _count: { _all: true },
    });
  }
  findOpenOrdersDueForExpiry(now: Date) {
    return prisma.carpoolOrder
      .findMany({
        where: {
          state: "open",
          OR: [{ formationDeadlineAt: { lte: now } }, { formationDeadlineAt: null, inviteExpiresAt: { lte: now } }],
        },
        select: { id: true },
        take: 200,
      })
      .then((orders) => orders.map((order) => order.id));
  }
  findOpenOrdersMissingFormationDeadline(take = 200) {
    return prisma.carpoolOrder.findMany({
      where: { state: "open", formationDeadlineAt: null, inviteExpiresAt: { not: null } },
      select: { id: true, inviteExpiresAt: true },
      orderBy: { createTime: "asc" },
      take,
    });
  }
  backfillFormationDeadline(id: string, formationDeadlineAt: Date) {
    return prisma.carpoolOrder.updateMany({
      where: { id, state: "open", formationDeadlineAt: null },
      data: { formationDeadlineAt },
    });
  }
  listEligibleDeliveryChannels(page: number, pageSize: number, keyword?: string, allowedChannelIds?: string[]) {
    const where = {
      status: 1,
      providerServiceEnabled: true,
      submissionStatus: "approved",
      ...(allowedChannelIds?.length ? { id: { in: allowedChannelIds } } : {}),
      ...(keyword ? { OR: [{ name: { contains: keyword } }, { id: { contains: keyword } }] } : {}),
    } satisfies Prisma.RelayChannelWhereInput;
    return Promise.all([
      prisma.relayChannel.count({ where }),
      prisma.relayChannel.findMany({
        where,
        select: { id: true, name: true, channelType: true },
        orderBy: { name: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
  }
}

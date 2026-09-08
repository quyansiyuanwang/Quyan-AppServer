import { prisma } from "@/config/database";
import { Prisma } from "@prisma/client";

export const carpoolOrderInclude = {
  members: {
    include: { user: { select: { username: true } }, reservation: true, relayToken: true, userMonthlyPass: true },
    orderBy: { createTime: "asc" },
  },
  relayChannel: { select: { id: true, name: true } },
} satisfies Prisma.CarpoolOrderInclude;
export type CarpoolOrderRecord = Prisma.CarpoolOrderGetPayload<{ include: typeof carpoolOrderInclude }>;
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
  createTemplate(data: Prisma.CarpoolPackageTemplateUncheckedCreateInput) {
    return prisma.carpoolPackageTemplate.create({ data });
  }
  updateTemplatePublication(id: string, published: boolean) {
    return prisma.carpoolPackageTemplate.update({
      where: { id },
      data: { publishStatus: published ? "published" : "draft", publishedAt: published ? new Date() : null },
    });
  }
  findPublishedTemplate(id: string) {
    return prisma.carpoolPackageTemplate.findFirst({
      where: { id, status: 1, publishStatus: "published" },
    });
  }
  createInvite(data: Prisma.CarpoolInviteCreateInput) {
    return prisma.carpoolInvite.create({ data });
  }
  findOrderSummary(id: string) {
    return prisma.carpoolOrder.findUnique({ where: { id } });
  }
  acceptOrder(id: string) {
    return prisma.carpoolOrder.update({ where: { id }, data: { state: "accepted", acceptedAt: new Date() } });
  }
  findTemplates(page: number, pageSize: number) {
    const where = { status: { gte: 0 } } satisfies Prisma.CarpoolPackageTemplateWhereInput;
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
  findOrder(id: string) {
    return prisma.carpoolOrder.findUnique({ where: { id }, include: carpoolOrderInclude });
  }
  findOrdersForUser(userId: string, page: number, pageSize: number) {
    const where = { members: { some: { userId } } } satisfies Prisma.CarpoolOrderWhereInput;
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
  findOrdersForAdmin(state: string | undefined, page: number, pageSize: number) {
    const where = { ...(state ? { state } : {}) } satisfies Prisma.CarpoolOrderWhereInput;
    return Promise.all([
      prisma.carpoolOrder.count({ where }),
      prisma.carpoolOrder.findMany({
        where,
        include: carpoolOrderInclude,
        orderBy: { submittedAt: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
  }
}

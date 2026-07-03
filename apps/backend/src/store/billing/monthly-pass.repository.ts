import { prisma } from "@/config/database";
import { BadRequestError } from "@/util/errors";
import type { MonthlyPassTemplate, MonthlyPassUsage, Prisma, UserMonthlyPass } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import type {
  ActiveMonthlyPassCandidate,
  MonthlyPassQuotaUnit,
  MonthlyPassQuotaWindowInput,
  MonthlyPassTemplateWithQuotaWindows,
  MonthlyPassUsageSummary,
  MonthlyPassUsageSummaryRule,
  MonthlyPassStore,
  MonthlyPassUsageWithDetails,
  UserMonthlyPassWithTemplate,
} from "./monthly-pass.store";
import { MANAGED_STATUS } from "@/constant/status";

export type {
  ActiveMonthlyPassCandidate,
  MonthlyPassUsageSummaryRule,
  UserMonthlyPassWithTemplate,
  MonthlyPassTemplateWithQuotaWindows,
  MonthlyPassUsageWithDetails,
} from "./monthly-pass.store";

const getUsageSummaryPassHoursKey = (passId: string, quotaWindowHours: number): string =>
  `${passId}:${quotaWindowHours}`;
const getUsageSummaryRuleKey = (passId: string, quotaUnit: MonthlyPassQuotaUnit, quotaWindowHours: number): string =>
  `${passId}:${quotaWindowHours}:${quotaUnit}`;

const monthlyPassTemplateInclude = {
  quotaWindows: {
    orderBy: [{ quotaWindowHours: "asc" }, { createTime: "asc" }],
  },
} satisfies Prisma.MonthlyPassTemplateInclude;

const userMonthlyPassInclude = {
  template: {
    include: {
      quotaWindows: {
        orderBy: [{ quotaWindowHours: "asc" }, { createTime: "asc" }],
      },
    },
  },
  quotaWindows: {
    orderBy: [{ quotaWindowHours: "asc" }, { createTime: "asc" }],
  },
  user: { select: { username: true } },
} satisfies Prisma.UserMonthlyPassInclude;

const buildQuotaWindowCreateManyData = (quotaWindows: MonthlyPassQuotaWindowInput[]) =>
  quotaWindows.map((quotaWindow) => ({
    quotaLimit: quotaWindow.quotaLimit,
    quotaUnit: quotaWindow.quotaUnit,
    quotaWindowHours: quotaWindow.quotaWindowHours,
  }));

export class MonthlyPassRepository implements MonthlyPassStore {
  private static instance: MonthlyPassRepository;

  public static getInstance(): MonthlyPassRepository {
    if (!MonthlyPassRepository.instance) MonthlyPassRepository.instance = new MonthlyPassRepository();

    return MonthlyPassRepository.instance;
  }

  private async chargePurchase(
    tx: Prisma.TransactionClient,
    data: { userId: string; purchaseAmount: number; templateName: string; templateId: string },
  ): Promise<void> {
    if (data.purchaseAmount <= 0) return;

    const account = await tx.balanceAccount.findUnique({ where: { userId: data.userId } });
    const balanceBefore = account ? Number(account.balance) : 0;

    if (!account || balanceBefore < data.purchaseAmount) throw new BadRequestError("Insufficient balance");

    const currentTotalRecharged = Number(account.totalRecharged);
    const currentTotalUsed = Number(account.totalUsed);
    const newTotalUsed = currentTotalUsed + data.purchaseAmount;
    const newBalance = currentTotalRecharged - newTotalUsed;

    const updatedAccount = await tx.balanceAccount.update({
      where: { userId: data.userId },
      data: {
        balance: new Decimal(newBalance),
        totalUsed: { increment: data.purchaseAmount },
      },
    });

    await tx.balanceTransaction.create({
      data: {
        userId: data.userId,
        type: "monthly_pass_purchase",
        amount: new Decimal(-data.purchaseAmount),
        balanceBefore: new Decimal(balanceBefore),
        balanceAfter: new Decimal(updatedAccount.balance),
        relatedId: data.templateId,
        description: `月卡购买: ${data.templateName}`,
        model: "monthly_pass",
      },
    });
  }

  async findTemplateById(id: string): Promise<MonthlyPassTemplateWithQuotaWindows | null> {
    return prisma.monthlyPassTemplate.findUnique({ where: { id }, include: monthlyPassTemplateInclude });
  }

  async findTemplateByName(name: string): Promise<MonthlyPassTemplate | null> {
    return prisma.monthlyPassTemplate.findFirst({
      where: {
        name,
        status: { gte: MANAGED_STATUS.DISABLED },
      },
    });
  }

  async createTemplate(
    data: Prisma.MonthlyPassTemplateUncheckedCreateInput,
    quotaWindows: MonthlyPassQuotaWindowInput[] = [],
  ): Promise<MonthlyPassTemplateWithQuotaWindows> {
    return prisma.$transaction(async (tx) => {
      const created = await tx.monthlyPassTemplate.create({ data });

      if (quotaWindows.length > 0)
        await tx.monthlyPassTemplateQuotaWindow.createMany({
          data: buildQuotaWindowCreateManyData(quotaWindows).map((item) => ({
            monthlyPassTemplateId: created.id,
            ...item,
          })),
        });

      return tx.monthlyPassTemplate.findUniqueOrThrow({
        where: { id: created.id },
        include: monthlyPassTemplateInclude,
      });
    });
  }

  async updateTemplate(
    id: string,
    data: Prisma.MonthlyPassTemplateUncheckedUpdateInput,
    quotaWindows?: MonthlyPassQuotaWindowInput[],
  ): Promise<MonthlyPassTemplateWithQuotaWindows> {
    return prisma.$transaction(async (tx) => {
      await tx.monthlyPassTemplate.update({ where: { id }, data });

      if (quotaWindows !== undefined) {
        await tx.monthlyPassTemplateQuotaWindow.deleteMany({ where: { monthlyPassTemplateId: id } });
        if (quotaWindows.length > 0)
          await tx.monthlyPassTemplateQuotaWindow.createMany({
            data: buildQuotaWindowCreateManyData(quotaWindows).map((item) => ({
              monthlyPassTemplateId: id,
              ...item,
            })),
          });
      }

      return tx.monthlyPassTemplate.findUniqueOrThrow({
        where: { id },
        include: monthlyPassTemplateInclude,
      });
    });
  }

  async softDeleteTemplate(id: string): Promise<MonthlyPassTemplate> {
    return prisma.monthlyPassTemplate.update({
      where: { id },
      data: { status: MANAGED_STATUS.DELETED },
    });
  }

  async listPublishedTemplates(): Promise<MonthlyPassTemplateWithQuotaWindows[]> {
    return prisma.monthlyPassTemplate.findMany({
      where: {
        status: MANAGED_STATUS.ENABLED,
        publishStatus: "published",
      },
      include: monthlyPassTemplateInclude,
      orderBy: [{ publishedAt: "desc" }, { updateTime: "desc" }],
    });
  }

  async listTemplates(
    where: Prisma.MonthlyPassTemplateWhereInput,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; records: MonthlyPassTemplateWithQuotaWindows[] }> {
    const [total, records] = await Promise.all([
      prisma.monthlyPassTemplate.count({ where }),
      prisma.monthlyPassTemplate.findMany({
        where,
        include: monthlyPassTemplateInclude,
        orderBy: [{ updateTime: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { total, records };
  }

  async findUserPassById(id: string): Promise<UserMonthlyPassWithTemplate | null> {
    return prisma.userMonthlyPass.findUnique({
      where: { id },
      include: userMonthlyPassInclude,
    });
  }

  async findLatestUserPassByUserAndTemplate(
    userId: string,
    templateId: string,
  ): Promise<UserMonthlyPassWithTemplate | null> {
    return prisma.userMonthlyPass.findFirst({
      where: {
        userId,
        templateId,
        status: { gte: MANAGED_STATUS.DISABLED },
      },
      include: userMonthlyPassInclude,
      orderBy: [{ endAt: "desc" }, { createTime: "desc" }],
    });
  }

  async countUserPassesByUserAndTemplateSince(userId: string, templateId: string, startAt: Date): Promise<number> {
    return prisma.userMonthlyPass.count({
      where: {
        userId,
        templateId,
        status: { gte: MANAGED_STATUS.DISABLED },
        createTime: { gte: startAt },
      },
    });
  }

  async createUserPass(
    data: Prisma.UserMonthlyPassUncheckedCreateInput,
    quotaWindows: MonthlyPassQuotaWindowInput[] = [],
  ): Promise<UserMonthlyPassWithTemplate> {
    return prisma.$transaction(async (tx) => {
      const created = await tx.userMonthlyPass.create({ data });

      if (quotaWindows.length > 0)
        await tx.userMonthlyPassQuotaWindow.createMany({
          data: buildQuotaWindowCreateManyData(quotaWindows).map((item) => ({
            userMonthlyPassId: created.id,
            ...item,
          })),
        });

      return tx.userMonthlyPass.findUniqueOrThrow({
        where: { id: created.id },
        include: userMonthlyPassInclude,
      });
    });
  }

  async purchaseUserPass(
    data: Prisma.UserMonthlyPassUncheckedCreateInput,
    quotaWindows: MonthlyPassQuotaWindowInput[] = [],
    purchase: { userId: string; purchaseAmount: number; templateName: string; templateId: string },
  ): Promise<UserMonthlyPassWithTemplate> {
    return prisma.$transaction(async (tx) => {
      await this.chargePurchase(tx, purchase);

      const created = await tx.userMonthlyPass.create({ data });

      if (quotaWindows.length > 0)
        await tx.userMonthlyPassQuotaWindow.createMany({
          data: buildQuotaWindowCreateManyData(quotaWindows).map((item) => ({
            userMonthlyPassId: created.id,
            ...item,
          })),
        });

      return tx.userMonthlyPass.findUniqueOrThrow({
        where: { id: created.id },
        include: userMonthlyPassInclude,
      });
    });
  }

  async updateUserPass(
    id: string,
    data: Prisma.UserMonthlyPassUncheckedUpdateInput,
    quotaWindows?: MonthlyPassQuotaWindowInput[],
  ): Promise<UserMonthlyPassWithTemplate> {
    return prisma.$transaction(async (tx) => {
      await tx.userMonthlyPass.update({ where: { id }, data });

      if (quotaWindows !== undefined) {
        await tx.userMonthlyPassQuotaWindow.deleteMany({ where: { userMonthlyPassId: id } });
        if (quotaWindows.length > 0)
          await tx.userMonthlyPassQuotaWindow.createMany({
            data: buildQuotaWindowCreateManyData(quotaWindows).map((item) => ({
              userMonthlyPassId: id,
              ...item,
            })),
          });
      }

      return tx.userMonthlyPass.findUniqueOrThrow({
        where: { id },
        include: userMonthlyPassInclude,
      });
    });
  }

  async softDeleteUserPass(id: string): Promise<UserMonthlyPass> {
    return prisma.userMonthlyPass.update({
      where: { id },
      data: { status: MANAGED_STATUS.DELETED },
    });
  }

  async listUserPasses(
    where: Prisma.UserMonthlyPassWhereInput,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; records: UserMonthlyPassWithTemplate[] }> {
    const [total, records] = await Promise.all([
      prisma.userMonthlyPass.count({ where }),
      prisma.userMonthlyPass.findMany({
        where,
        include: userMonthlyPassInclude,
        orderBy: [{ endAt: "asc" }, { createTime: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { total, records };
  }

  async listUsageRecords(
    where: Prisma.MonthlyPassUsageWhereInput,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; records: MonthlyPassUsageWithDetails[] }> {
    const [total, records] = await Promise.all([
      prisma.monthlyPassUsage.count({ where }),
      prisma.monthlyPassUsage.findMany({
        where,
        include: {
          userMonthlyPass: {
            include: {
              template: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ createTime: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { total, records };
  }

  async findActivePassCandidates(userId: string, at: Date): Promise<ActiveMonthlyPassCandidate[]> {
    return prisma.userMonthlyPass.findMany({
      where: {
        userId,
        status: MANAGED_STATUS.ENABLED,
        remainingQuota: { gt: 0 },
        startAt: { lte: at },
        endAt: { gte: at },
        template: {
          status: MANAGED_STATUS.ENABLED,
        },
      },
      include: {
        template: true,
      },
      orderBy: [{ endAt: "asc" }, { createTime: "asc" }],
    });
  }

  async getUsageSummaryByQuotaWindowRules(
    quotaWindowRules: MonthlyPassUsageSummaryRule[],
    endAt: Date,
  ): Promise<Record<string, MonthlyPassUsageSummary>> {
    if (quotaWindowRules.length === 0) return {};

    const uniquePassIds = [...new Set(quotaWindowRules.map((item) => item.passId))];
    const uniqueWindowHours = [...new Set(quotaWindowRules.map((item) => Number(item.quotaWindowHours)))];
    const summaryByPassHoursKey: Record<string, MonthlyPassUsageSummary> = {};

    await Promise.all(
      uniqueWindowHours.map(async (windowHours) => {
        const startAt = new Date(endAt.getTime() - windowHours * 60 * 60 * 1000);
        const grouped = await prisma.monthlyPassUsage.groupBy({
          by: ["userMonthlyPassId"],
          where: {
            status: MANAGED_STATUS.ENABLED,
            userMonthlyPassId: { in: uniquePassIds },
            createTime: {
              gte: startAt,
              lte: endAt,
            },
          },
          _sum: {
            coveredAmount: true,
            coveredRequests: true,
            coveredTokens: true,
          },
        });

        for (const item of grouped)
          summaryByPassHoursKey[getUsageSummaryPassHoursKey(item.userMonthlyPassId, windowHours)] = {
            coveredAmount: Number(item._sum.coveredAmount || 0),
            coveredRequests: Number(item._sum.coveredRequests || 0),
            coveredTokens: Number(item._sum.coveredTokens || 0),
          };
      }),
    );

    const result: Record<string, MonthlyPassUsageSummary> = {};
    for (const rule of quotaWindowRules) {
      const summary = summaryByPassHoursKey[getUsageSummaryPassHoursKey(rule.passId, Number(rule.quotaWindowHours))];
      if (summary) result[getUsageSummaryRuleKey(rule.passId, rule.quotaUnit, Number(rule.quotaWindowHours))] = summary;
    }

    return result;
  }

  async createUsageRecord(data: Prisma.MonthlyPassUsageUncheckedCreateInput): Promise<MonthlyPassUsage> {
    return prisma.monthlyPassUsage.create({ data });
  }
}

import { summarizeMonthlyPassWindowUsage } from "./monthly-pass-usage-summary";
import { runMonthlyPassAssignmentWrite, type MonthlyPassAssignmentWriteGuard } from "./monthly-pass-assignment-write";
import { iamAccountDenied } from "../users/iam-account-principal";
import { runMonthlyPassTemplateWrite, type MonthlyPassTemplateWriteGuard } from "./monthly-pass-template-write";
import { prisma } from "@/config/database";
import { BadRequestError } from "@/util/errors";
import type { MonthlyPassTemplate, MonthlyPassUsage, Prisma, UserMonthlyPass } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import type {
  ActiveMonthlyPassCandidate,
  MonthlyPassQuotaWindowInput,
  MonthlyPassTemplateWithQuotaWindows,
  MonthlyPassUsageSummary,
  MonthlyPassUsageSummaryRule,
  MonthlyPassStore,
  MonthlyPassUsageWithDetails,
  UserMonthlyPassWithTemplate,
} from "./monthly-pass.store";
import { MANAGED_STATUS } from "@/constant/status";
import { applyBalanceAccountMutation } from "./balance-account-mutation";

export type {
  ActiveMonthlyPassCandidate,
  MonthlyPassUsageSummaryRule,
  UserMonthlyPassWithTemplate,
  MonthlyPassTemplateWithQuotaWindows,
  MonthlyPassUsageWithDetails,
} from "./monthly-pass.store";

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

    const mutation = await applyBalanceAccountMutation(tx, {
      userId: data.userId,
      balanceDelta: new Decimal(-data.purchaseAmount),
      totalUsedDelta: new Decimal(data.purchaseAmount),
      minimumBalance: 0,
    });
    if (!mutation)
      throw new BadRequestError("Insufficient balance", undefined, { messageKey: "billing.insufficientBalance" });

    await tx.balanceTransaction.create({
      data: {
        userId: data.userId,
        type: "monthly_pass_purchase",
        amount: new Decimal(-data.purchaseAmount),
        balanceBefore: mutation.balanceBefore,
        balanceAfter: mutation.balanceAfter,
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
    guard?: MonthlyPassTemplateWriteGuard,
  ): Promise<MonthlyPassTemplateWithQuotaWindows> {
    return runMonthlyPassTemplateWrite(guard, undefined, data, async (tx) => {
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
    guard?: MonthlyPassTemplateWriteGuard,
  ): Promise<MonthlyPassTemplateWithQuotaWindows> {
    if (guard && guard.operation !== "UpdateTemplate" && quotaWindows !== undefined) throw iamAccountDenied();
    return runMonthlyPassTemplateWrite(guard, id, data, async (tx) => {
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

  async softDeleteTemplate(id: string, guard?: MonthlyPassTemplateWriteGuard): Promise<MonthlyPassTemplate> {
    const data = { status: MANAGED_STATUS.DELETED };
    return runMonthlyPassTemplateWrite(guard, id, data, (tx) => tx.monthlyPassTemplate.update({ where: { id }, data }));
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
        orderBy: [{ name: "asc" }, { updateTime: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { total, records };
  }

  async findUserPassIdentity(id: string) {
    return prisma.userMonthlyPass.findUnique({ where: { id }, select: { id: true, userId: true, status: true } });
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
    purchase: {
      userId: string;
      purchaseAmount: number;
      templateName: string;
      templateId: string;
      limit?: { maximum: number; windowStart: Date };
    },
  ): Promise<UserMonthlyPassWithTemplate> {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM balance_accounts WHERE userId = ${purchase.userId} FOR UPDATE`;

      if (purchase.limit) {
        const currentCount = await tx.userMonthlyPass.count({
          where: {
            userId: purchase.userId,
            templateId: purchase.templateId,
            status: { gte: MANAGED_STATUS.DISABLED },
            createTime: { gte: purchase.limit.windowStart },
          },
        });
        if (currentCount >= purchase.limit.maximum)
          throw new BadRequestError(`purchase limit exceeded: at most ${purchase.limit.maximum} claim(s)`, undefined, {
            messageKey: "monthlyPass.purchaseLimitExceededShort",
            messageParams: { limit: purchase.limit.maximum },
          });
      }

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
    guard?: MonthlyPassAssignmentWriteGuard,
  ): Promise<UserMonthlyPassWithTemplate> {
    if (guard && guard.operation !== "UpdateUserPass") throw iamAccountDenied();
    return runMonthlyPassAssignmentWrite(guard, id, data, async (tx) => {
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

  async softDeleteUserPass(id: string, guard?: MonthlyPassAssignmentWriteGuard): Promise<UserMonthlyPass> {
    if (guard && guard.operation !== "DeleteUserPass") throw iamAccountDenied();
    const data = { status: MANAGED_STATUS.DELETED };
    return runMonthlyPassAssignmentWrite(guard, id, data, (tx) => tx.userMonthlyPass.update({ where: { id }, data }));
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
    return summarizeMonthlyPassWindowUsage(prisma, quotaWindowRules, endAt);
  }

  async createUsageRecord(data: Prisma.MonthlyPassUsageUncheckedCreateInput): Promise<MonthlyPassUsage> {
    return prisma.monthlyPassUsage.create({ data });
  }
}

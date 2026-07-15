import type {
  MonthlyPassTemplate,
  MonthlyPassTemplateQuotaWindow,
  MonthlyPassUsage,
  Prisma,
  UserMonthlyPass,
  UserMonthlyPassQuotaWindow,
} from "@prisma/client";

export type MonthlyPassQuotaUnit = "amount" | "request" | "token";

export interface MonthlyPassQuotaWindowInput {
  quotaLimit: number;
  quotaUnit: MonthlyPassQuotaUnit;
  quotaWindowHours: number;
}

export type MonthlyPassTemplateQuotaWindowSnapshot = Pick<
  MonthlyPassTemplateQuotaWindow,
  "id" | "quotaLimit" | "quotaUnit" | "quotaWindowHours"
>;

export type UserMonthlyPassQuotaWindowSnapshot = Pick<
  UserMonthlyPassQuotaWindow,
  "id" | "quotaLimit" | "quotaUnit" | "quotaWindowHours"
>;

export type MonthlyPassTemplateWithQuotaWindows = Prisma.MonthlyPassTemplateGetPayload<{
  include: {
    quotaWindows: {
      orderBy: [{ quotaWindowHours: "asc" }, { createTime: "asc" }];
    };
  };
}>;

export type UserMonthlyPassWithTemplate = Prisma.UserMonthlyPassGetPayload<{
  include: {
    template: {
      include: {
        quotaWindows: {
          orderBy: [{ quotaWindowHours: "asc" }, { createTime: "asc" }];
        };
      };
    };
    quotaWindows: {
      orderBy: [{ quotaWindowHours: "asc" }, { createTime: "asc" }];
    };
    user: { select: { username: true } };
  };
}>;

export type MonthlyPassUsageWithDetails = Prisma.MonthlyPassUsageGetPayload<{
  include: {
    userMonthlyPass: {
      include: {
        template: { select: { id: true; name: true } };
      };
    };
  };
}>;

export type ActiveMonthlyPassCandidate = Prisma.UserMonthlyPassGetPayload<{
  include: { template: true };
}>;

export interface MonthlyPassUsageSummary {
  coveredAmount: number;
  coveredRequests: number;
  coveredTokens: number;
}

export interface MonthlyPassUsageSummaryRule {
  passId: string;
  quotaUnit: MonthlyPassQuotaUnit;
  quotaWindowHours: number;
}

export interface MonthlyPassStore {
  findTemplateById(id: string): Promise<MonthlyPassTemplateWithQuotaWindows | null>;
  findTemplateByName(name: string): Promise<MonthlyPassTemplate | null>;
  createTemplate(
    data: Prisma.MonthlyPassTemplateUncheckedCreateInput,
    quotaWindows?: MonthlyPassQuotaWindowInput[],
  ): Promise<MonthlyPassTemplateWithQuotaWindows>;
  updateTemplate(
    id: string,
    data: Prisma.MonthlyPassTemplateUncheckedUpdateInput,
    quotaWindows?: MonthlyPassQuotaWindowInput[],
  ): Promise<MonthlyPassTemplateWithQuotaWindows>;
  softDeleteTemplate(id: string): Promise<MonthlyPassTemplate>;
  listPublishedTemplates(): Promise<MonthlyPassTemplateWithQuotaWindows[]>;
  listTemplates(
    where: Prisma.MonthlyPassTemplateWhereInput,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; records: MonthlyPassTemplateWithQuotaWindows[] }>;

  findUserPassById(id: string): Promise<UserMonthlyPassWithTemplate | null>;
  findLatestUserPassByUserAndTemplate(userId: string, templateId: string): Promise<UserMonthlyPassWithTemplate | null>;
  countUserPassesByUserAndTemplateSince(userId: string, templateId: string, startAt: Date): Promise<number>;
  createUserPass(
    data: Prisma.UserMonthlyPassUncheckedCreateInput,
    quotaWindows?: MonthlyPassQuotaWindowInput[],
  ): Promise<UserMonthlyPassWithTemplate>;
  purchaseUserPass(
    data: Prisma.UserMonthlyPassUncheckedCreateInput,
    quotaWindows: MonthlyPassQuotaWindowInput[],
    purchase: {
      userId: string;
      purchaseAmount: number;
      templateName: string;
      templateId: string;
      limit?: { maximum: number; windowStart: Date };
    },
  ): Promise<UserMonthlyPassWithTemplate>;
  updateUserPass(
    id: string,
    data: Prisma.UserMonthlyPassUncheckedUpdateInput,
    quotaWindows?: MonthlyPassQuotaWindowInput[],
  ): Promise<UserMonthlyPassWithTemplate>;
  softDeleteUserPass(id: string): Promise<UserMonthlyPass>;
  listUserPasses(
    where: Prisma.UserMonthlyPassWhereInput,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; records: UserMonthlyPassWithTemplate[] }>;

  listUsageRecords(
    where: Prisma.MonthlyPassUsageWhereInput,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; records: MonthlyPassUsageWithDetails[] }>;

  findActivePassCandidates(userId: string, at: Date): Promise<ActiveMonthlyPassCandidate[]>;

  getUsageSummaryByQuotaWindowRules(
    quotaWindowRules: MonthlyPassUsageSummaryRule[],
    endAt: Date,
  ): Promise<Record<string, MonthlyPassUsageSummary>>;

  createUsageRecord(data: Prisma.MonthlyPassUsageUncheckedCreateInput): Promise<MonthlyPassUsage>;
}

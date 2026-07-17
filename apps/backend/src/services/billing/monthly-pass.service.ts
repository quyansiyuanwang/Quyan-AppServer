import {
  AssignUserMonthlyPassRequest,
  AssignBatchUserMonthlyPassRequest,
  BatchAssignUserMonthlyPassItemDto,
  BatchAssignUserMonthlyPassResponse,
  ClaimMonthlyPassResultDto,
  ClaimMonthlyPassTemplateRequest,
  CreateMonthlyPassTemplateRequest,
  MonthlyPassFilterOptionsDto,
  MonthlyPassGroupFilterOptionDto,
  MonthlyPassNumberFilterOptionDto,
  MonthlyPassAssignmentMode,
  MonthlyPassQuotaUnit,
  MonthlyPassQuotaWindowDto,
  MonthlyPassQuotaWindowInputDto,
  MonthlyPassStringFilterOptionDto,
  MonthlyPassTemplatePublishStatus,
  MonthlyPassTemplateDto,
  MonthlyPassTemplateFilterOptionDto,
  MonthlyPassTemplateListResponse,
  MonthlyPassUsageDto,
  MonthlyPassUsageListResponse,
  UpdateMonthlyPassTemplateRequest,
  UpdateUserMonthlyPassRequest,
  UserMonthlyPassDto,
  UserMonthlyPassListResponse,
} from "@/api/dto/billing/monthly-pass.dto";
import type { Prisma } from "@prisma/client";
import { MonthlyPassRepository } from "@/store/billing/monthly-pass.repository";
import type {
  MonthlyPassQuotaWindowInput,
  MonthlyPassStore,
  MonthlyPassTemplateWithQuotaWindows,
  UserMonthlyPassWithTemplate,
} from "@/store/billing/monthly-pass.store";
import { UserRepository } from "@/store/users/user.repository";
import type { UserStore } from "@/store/users/user.store";
import { BadRequestError, NotFoundError } from "@/util/errors";
import {
  MONTHLY_PASS_DEFAULT_PAGE_SIZE,
  MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS,
  MONTHLY_PASS_MAX_PAGE_SIZE,
  MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS,
} from "@/constant/monthly-pass";
import { MANAGED_STATUS } from "@/constant/status";
import { AccountStatus } from "@/util/auth/account-status";
import {
  isMonthlyPassModelMatched,
  parseAllowedChannels,
  parseAllowedModels,
  serializeStringArray,
} from "@/util/monthly-pass.util";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import type { RelayChannelStore } from "@/store/relay/relay-channel.store";
import { GroupRepository } from "@/store/users/group.repository";
import type { GroupStore } from "@/store/users/group.store";
import { ModelPricingRepository } from "@/store/relay/model-pricing.repository";
import type { ModelPricingStore } from "@/store/relay/model-pricing.store";
import BusinessLogService from "@/services/system/businesslog.service";
import { ConfigService } from "@/services/system/config.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import type { Request } from "express";
import type { UserListFilters } from "@/store/users/user.store";
import { RelayPoolResolverService } from "@/services/relay/relay-pool-resolver.service";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { normalizeRelayDisplaySnapshotName } from "@/util/relay-display-channel.util";
import {
  getMonthlyPassDiscountPercentValidationError,
  getMonthlyPassPositiveIntegerValidationError,
  getMonthlyPassPriceValidationError,
  getMonthlyPassQuotaValidationError,
  getMonthlyPassQuotaWindowHoursValidationError,
  isMonthlyPassIntegerQuotaUnit,
  MONTHLY_PASS_PURCHASE_LIMIT_MAX,
  MONTHLY_PASS_PURCHASE_LIMIT_WINDOW_MAX_DAYS,
} from "@/util/monthly-pass-validation.util";

type DecimalLike = Prisma.Decimal | number | string;
const MAX_CHANNEL_LOOKUP_IDS = 1000;

const normalizePagination = (page?: number, pageSize?: number): { page: number; pageSize: number } => {
  const normalizedPage = page && page > 0 ? page : 1;
  const normalizedPageSize =
    pageSize && pageSize > 0 ? Math.min(pageSize, MONTHLY_PASS_MAX_PAGE_SIZE) : MONTHLY_PASS_DEFAULT_PAGE_SIZE;
  return { page: normalizedPage, pageSize: normalizedPageSize };
};

const round4 = (value: number): number => Math.round(value * 10000) / 10000;
const round2 = (value: number): number => Math.round(value * 100) / 100;
const MONTHLY_PASS_SELF_CLAIM_DURATION_DAYS = 30;
const BATCH_ASSIGNMENT_PAGE_SIZE = 100;
const DEFAULT_NUMBER_STATUS_OPTIONS: MonthlyPassNumberFilterOptionDto[] = [
  { value: MANAGED_STATUS.ENABLED, label: "enabled" },
  { value: MANAGED_STATUS.DISABLED, label: "disabled" },
];
const DEFAULT_PUBLISH_STATUS_OPTIONS: MonthlyPassStringFilterOptionDto[] = [
  { value: "draft", label: "draft" },
  { value: "published", label: "published" },
];
const DEFAULT_ASSIGNMENT_MODE_OPTIONS: MonthlyPassStringFilterOptionDto[] = [
  { value: "create_new", label: "create_new" },
  { value: "extend_existing", label: "extend_existing" },
];
const DEFAULT_QUOTA_UNIT_OPTIONS: MonthlyPassStringFilterOptionDto[] = [
  { value: "amount", label: "amount" },
  { value: "request", label: "request" },
  { value: "token", label: "token" },
];

const normalizeQuotaUnit = (value?: string | null): MonthlyPassQuotaUnit => {
  if (value === "request" || value === "token") return value;
  return "amount";
};

const isIntegerQuotaUnit = (unit: MonthlyPassQuotaUnit): boolean => {
  return isMonthlyPassIntegerQuotaUnit(unit);
};

const normalizeTemplatePublishStatus = (value?: string | null): MonthlyPassTemplatePublishStatus => {
  return value === "published" ? "published" : "draft";
};

const normalizeQuotaValue = (value: number, unit: MonthlyPassQuotaUnit): number => {
  if (isIntegerQuotaUnit(unit)) return Math.floor(value);
  return round4(value);
};

const normalizePriceValue = (value: number): number => round4(value);

const normalizeDiscountPercentValue = (value: number): number => round2(value);

const validateOptionalPositiveIntegerOrNull = (fieldName: string, value?: number | null): number | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const max =
    fieldName === "purchaseLimitPerUser"
      ? MONTHLY_PASS_PURCHASE_LIMIT_MAX
      : MONTHLY_PASS_PURCHASE_LIMIT_WINDOW_MAX_DAYS;
  const message = getMonthlyPassPositiveIntegerValidationError(fieldName, value, max);
  if (message) throw new BadRequestError(message);
  return value;
};

const validatePurchaseLimitConfig = (
  purchaseLimitPerUser?: number | null,
  purchaseLimitWindowDays?: number | null,
): { purchaseLimitPerUser: number | null | undefined; purchaseLimitWindowDays: number | null | undefined } => {
  const normalizedLimit = validateOptionalPositiveIntegerOrNull("purchaseLimitPerUser", purchaseLimitPerUser);
  const normalizedWindow = validateOptionalPositiveIntegerOrNull("purchaseLimitWindowDays", purchaseLimitWindowDays);

  const hasLimit = normalizedLimit !== undefined && normalizedLimit !== null;
  const hasWindow = normalizedWindow !== undefined && normalizedWindow !== null;
  if (hasLimit !== hasWindow)
    throw new BadRequestError("purchaseLimitPerUser and purchaseLimitWindowDays must be set together");

  return {
    purchaseLimitPerUser: normalizedLimit,
    purchaseLimitWindowDays: normalizedWindow,
  };
};
const normalizeAssignmentMode = (value?: MonthlyPassAssignmentMode): MonthlyPassAssignmentMode => {
  return value === "extend_existing" ? "extend_existing" : "create_new";
};

const parseDateStringOrThrow = (fieldName: "startTime" | "endTime", value?: string): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestError(`${fieldName} must be a valid date string`);
  return parsed;
};

const parseRequiredDateStringOrThrow = (fieldName: "startAt" | "endAt", value: string): Date => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestError(`${fieldName} must be a valid date string`);
  return parsed;
};

const validateQuotaValue = (
  fieldName: "defaultQuota" | "dailyQuota" | "totalQuota",
  value: number,
  unit: MonthlyPassQuotaUnit,
): void => {
  const message = getMonthlyPassQuotaValidationError(fieldName, value, unit);
  if (message) throw new BadRequestError(message);
};

const validatePriceValue = (
  fieldName: "originalPrice" | "discountedPrice" | "rechargeRatio",
  value: number,
  options: { allowZero?: boolean } = {},
): void => {
  const message = getMonthlyPassPriceValidationError(fieldName, value, options);
  if (message) throw new BadRequestError(message);
};

const validateDiscountPercentValue = (value: number): void => {
  const message = getMonthlyPassDiscountPercentValidationError(value);
  if (message) throw new BadRequestError(message);
};

const isPriceFirstTemplateRecord = (record: {
  originalPrice: DecimalLike | null;
  discountPercent: DecimalLike | null;
}): boolean => {
  return record.originalPrice != null || record.discountPercent != null;
};

const normalizeQuotaWindowHours = (value?: number | null, enforceMax = false): number | null => {
  if (value == null) return null;
  const error = getMonthlyPassQuotaWindowHoursValidationError(value, { allowExceedMax: !enforceMax });
  if (error) {
    if (enforceMax) throw new BadRequestError(error);
    return null;
  }

  if (value > MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS) {
    // Clamp legacy overflow values so existing records remain usable while new input is validated.
    return MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS;
  }
  return value;
};

const getWindowConsumed = (
  summary: { coveredAmount: number; coveredRequests: number; coveredTokens: number } | undefined,
  unit: MonthlyPassQuotaUnit,
): number => {
  if (!summary) return 0;
  if (unit === "request") return summary.coveredRequests;
  if (unit === "token") return summary.coveredTokens;
  return summary.coveredAmount;
};

const getQuotaWindowUsageKey = (passId: string, quotaUnit: MonthlyPassQuotaUnit, quotaWindowHours: number): string =>
  `${passId}:${quotaWindowHours}:${quotaUnit}`;

export class MonthlyPassService {
  private static instance: MonthlyPassService;

  private constructor(
    private readonly monthlyPassRepository: MonthlyPassStore = MonthlyPassRepository.getInstance(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly relayChannelRepository: RelayChannelStore = RelayChannelRepository.getInstance(),
    private readonly groupRepository: GroupStore = GroupRepository.getInstance(),
    private readonly modelPricingRepository: ModelPricingStore = ModelPricingRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly configService: ConfigService = ConfigService.getInstance(),
    private readonly relayPoolResolver: RelayPoolResolverService = RelayPoolResolverService.getInstance(),
    private readonly relayChannelService: RelayChannelService = RelayChannelService.getInstance(),
  ) {}

  public static getInstance(): MonthlyPassService {
    if (!MonthlyPassService.instance) MonthlyPassService.instance = new MonthlyPassService();

    return MonthlyPassService.instance;
  }

  private toQuotaWindowDto(
    record: { id: string; quotaLimit: DecimalLike; quotaUnit: string; quotaWindowHours: DecimalLike },
    usageSummary?: { coveredAmount: number; coveredRequests: number; coveredTokens: number },
  ): MonthlyPassQuotaWindowDto {
    const quotaLimit = Number(record.quotaLimit);
    const quotaUnit = normalizeQuotaUnit(record.quotaUnit);
    const quotaWindowHours = Number(record.quotaWindowHours);

    if (!usageSummary)
      return {
        id: record.id,
        quotaLimit,
        quotaUnit,
        quotaWindowHours,
      };

    const usedQuota = normalizeQuotaValue(getWindowConsumed(usageSummary, quotaUnit), quotaUnit);
    const remainingQuota = normalizeQuotaValue(Math.max(quotaLimit - usedQuota, 0), quotaUnit);
    const quotaUsagePercent = quotaLimit > 0 ? (usedQuota / quotaLimit) * 100 : undefined;

    return {
      id: record.id,
      quotaLimit,
      quotaUnit,
      quotaWindowHours,
      usedQuota,
      remainingQuota,
      quotaUsagePercent,
      isQuotaExceeded: remainingQuota <= 0,
    };
  }

  private synthesizeLegacyQuotaWindows(
    dailyQuota: number | null | undefined,
    quotaUnit: MonthlyPassQuotaUnit,
    quotaWindowHours: number | null | undefined,
  ): MonthlyPassQuotaWindowInput[] {
    if (dailyQuota == null) return [];

    const normalizedQuotaWindowHours =
      normalizeQuotaWindowHours(quotaWindowHours ?? MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS, true) ??
      MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS;

    return [
      {
        quotaLimit: normalizeQuotaValue(dailyQuota, quotaUnit),
        quotaUnit,
        quotaWindowHours: normalizedQuotaWindowHours,
      },
    ];
  }

  private normalizeQuotaWindows(quotaWindows?: MonthlyPassQuotaWindowInputDto[]): MonthlyPassQuotaWindowInput[] {
    if (!quotaWindows?.length) return [];

    const seenRuleKeys = new Set<string>();
    const normalizedWindows = quotaWindows.map((quotaWindow) => {
      const quotaUnit = normalizeQuotaUnit(quotaWindow.quotaUnit);
      const quotaLimit = Number(quotaWindow.quotaLimit);
      const quotaWindowHours = normalizeQuotaWindowHours(Number(quotaWindow.quotaWindowHours), true);

      if (quotaWindowHours == null) throw new BadRequestError("quotaWindowHours is required");
      validateQuotaValue("dailyQuota", quotaLimit, quotaUnit);

      const ruleKey = `${quotaUnit}:${quotaWindowHours}`;
      if (seenRuleKeys.has(ruleKey)) throw new BadRequestError("quotaWindowHours + quotaUnit must be unique");
      seenRuleKeys.add(ruleKey);

      return {
        quotaLimit: normalizeQuotaValue(quotaLimit, quotaUnit),
        quotaUnit,
        quotaWindowHours,
      };
    });

    return normalizedWindows.sort((a, b) => {
      if (a.quotaWindowHours !== b.quotaWindowHours) return a.quotaWindowHours - b.quotaWindowHours;
      return a.quotaUnit.localeCompare(b.quotaUnit);
    });
  }

  private getTemplateQuotaWindows(
    record: Pick<MonthlyPassTemplateWithQuotaWindows, "dailyQuota" | "quotaUnit" | "quotaWindowHours" | "quotaWindows">,
  ): MonthlyPassQuotaWindowInput[] {
    if (Array.isArray(record.quotaWindows) && record.quotaWindows.length > 0)
      return record.quotaWindows.map((item) => ({
        quotaLimit: Number(item.quotaLimit),
        quotaUnit: normalizeQuotaUnit(item.quotaUnit),
        quotaWindowHours: Number(item.quotaWindowHours),
      }));

    return this.synthesizeLegacyQuotaWindows(
      record.dailyQuota == null ? null : Number(record.dailyQuota),
      normalizeQuotaUnit(record.quotaUnit),
      record.quotaWindowHours == null ? null : Number(record.quotaWindowHours),
    );
  }

  private getUserPassQuotaWindows(
    record: Pick<UserMonthlyPassWithTemplate, "dailyQuota" | "quotaUnit" | "quotaWindowHours" | "quotaWindows">,
  ): MonthlyPassQuotaWindowInput[] {
    if (Array.isArray(record.quotaWindows) && record.quotaWindows.length > 0)
      return record.quotaWindows.map((item) => ({
        quotaLimit: Number(item.quotaLimit),
        quotaUnit: normalizeQuotaUnit(item.quotaUnit),
        quotaWindowHours: Number(item.quotaWindowHours),
      }));

    return this.synthesizeLegacyQuotaWindows(
      record.dailyQuota == null ? null : Number(record.dailyQuota),
      normalizeQuotaUnit(record.quotaUnit),
      record.quotaWindowHours == null ? null : Number(record.quotaWindowHours),
    );
  }

  private resolveQuotaWindowsForPersist(options: {
    explicitQuotaWindows?: MonthlyPassQuotaWindowInputDto[];
    dailyQuota?: number | null;
    quotaUnit: MonthlyPassQuotaUnit;
    quotaWindowHours?: number | null;
  }): MonthlyPassQuotaWindowInput[] {
    if (options.explicitQuotaWindows !== undefined) return this.normalizeQuotaWindows(options.explicitQuotaWindows);
    return this.synthesizeLegacyQuotaWindows(options.dailyQuota, options.quotaUnit, options.quotaWindowHours);
  }

  private async getQuotaWindowUsageSummaryMap(
    passes: Array<
      Pick<UserMonthlyPassWithTemplate, "id" | "dailyQuota" | "quotaUnit" | "quotaWindowHours" | "quotaWindows">
    >,
    at: Date,
  ): Promise<Record<string, { coveredAmount: number; coveredRequests: number; coveredTokens: number }>> {
    const quotaWindowRules = passes.flatMap((item) =>
      this.getUserPassQuotaWindows(item).map((rule) => ({
        passId: item.id,
        quotaUnit: rule.quotaUnit,
        quotaWindowHours: rule.quotaWindowHours,
      })),
    );

    if (quotaWindowRules.length === 0) return {};

    return this.monthlyPassRepository.getUsageSummaryByQuotaWindowRules(quotaWindowRules, at);
  }

  private async resolveBatchTargetUsers(
    actorUserId: string,
    data: AssignBatchUserMonthlyPassRequest,
  ): Promise<Array<{ id: string; username?: string }>> {
    const userIdSet = new Set<string>();

    for (const userId of data.userIds || []) {
      const trimmed = userId.trim();
      if (trimmed) userIdSet.add(trimmed);
    }

    const targetFilter = data.targetFilter;
    const shouldQueryVisibleUsers =
      targetFilter != null &&
      (Boolean(targetFilter.includeAllVisible) || Boolean(targetFilter.keyword) || Boolean(targetFilter.groupId));

    if (shouldQueryVisibleUsers) {
      const visibleLevel = await this.getVisibleUserLevel(actorUserId);
      if (visibleLevel != null) {
        const filters: UserListFilters = {
          keyword: targetFilter?.keyword,
          groupId: targetFilter?.groupId,
        };
        const total = await this.userRepository.countNonDeletedByGroupLevelGte(visibleLevel, filters);
        const pages = Math.ceil(total / BATCH_ASSIGNMENT_PAGE_SIZE);

        for (let page = 0; page < pages; page += 1) {
          const users = await this.userRepository.listNonDeletedByGroupLevelGtePaginated(visibleLevel, {
            ...filters,
            skip: page * BATCH_ASSIGNMENT_PAGE_SIZE,
            take: BATCH_ASSIGNMENT_PAGE_SIZE,
          });
          for (const user of users) userIdSet.add(user.id);
        }
      }
    }

    if (userIdSet.size === 0) throw new BadRequestError("No target users found");

    const usernames = await this.userRepository.findUsernamesByIds([...userIdSet]);
    const usernameMap = new Map(usernames.map((item) => [item.id, item.username]));

    return [...userIdSet].map((id) => ({ id, username: usernameMap.get(id) || undefined }));
  }

  private async getVisibleUserLevel(userId: string): Promise<number | null> {
    const requestingUser = await this.userRepository.findByIdWithGroup(userId);
    if (!requestingUser?.group) return null;
    return requestingUser.group.level;
  }

  private toTemplateDto(record: {
    id: string;
    name: string;
    description: string | null;
    publishStatus: string;
    publishedAt: Date | null;
    allowBalanceRedemption: boolean;
    purchaseLimitPerUser: number | null;
    purchaseLimitWindowDays: number | null;
    originalPrice: DecimalLike | null;
    discountPercent: DecimalLike | null;
    discountedPrice: DecimalLike | null;
    rechargeRatio: DecimalLike | null;
    defaultQuota: DecimalLike;
    dailyQuota: DecimalLike | null;
    quotaUnit: string;
    quotaWindowHours: number | null;
    quotaWindows?: Array<{ id: string; quotaLimit: DecimalLike; quotaUnit: string; quotaWindowHours: DecimalLike }>;
    allowedModels: string | null;
    allowedChannels: string | null;
    status: number;
    createTime: Date;
    updateTime: Date;
  }): MonthlyPassTemplateDto {
    return {
      id: record.id,
      name: record.name,
      description: record.description || undefined,
      publishStatus: normalizeTemplatePublishStatus(record.publishStatus),
      publishedAt: record.publishedAt || undefined,
      allowBalanceRedemption: record.allowBalanceRedemption,
      purchaseLimitPerUser: record.purchaseLimitPerUser ?? undefined,
      purchaseLimitWindowDays: record.purchaseLimitWindowDays ?? undefined,
      originalPrice: record.originalPrice == null ? undefined : Number(record.originalPrice),
      discountPercent: record.discountPercent == null ? undefined : Number(record.discountPercent),
      discountedPrice: record.discountedPrice == null ? undefined : Number(record.discountedPrice),
      rechargeRatio: record.rechargeRatio == null ? undefined : Number(record.rechargeRatio),
      defaultQuota: Number(record.defaultQuota),
      dailyQuota: record.dailyQuota == null ? undefined : Number(record.dailyQuota),
      quotaUnit: normalizeQuotaUnit(record.quotaUnit),
      quotaWindowHours: record.quotaWindowHours == null ? undefined : Number(record.quotaWindowHours),
      quotaWindows:
        record.quotaWindows && record.quotaWindows.length > 0
          ? record.quotaWindows.map((item) => this.toQuotaWindowDto(item))
          : this.synthesizeLegacyQuotaWindows(
              record.dailyQuota == null ? null : Number(record.dailyQuota),
              normalizeQuotaUnit(record.quotaUnit),
              record.quotaWindowHours == null ? null : Number(record.quotaWindowHours),
            ).map((item, index) => ({
              id: `legacy-template-window-${record.id}-${index}`,
              quotaLimit: item.quotaLimit,
              quotaUnit: item.quotaUnit,
              quotaWindowHours: item.quotaWindowHours,
            })),
      allowedModels: parseAllowedModels(record.allowedModels) || undefined,
      allowedChannels: parseAllowedChannels(record.allowedChannels) || undefined,
      status: record.status,
      createTime: record.createTime,
      updateTime: record.updateTime,
    };
  }

  private async deriveTemplatePricing(input: {
    originalPrice: number;
    discountPercent: number;
    dailyQuota?: number | null;
  }): Promise<{
    originalPrice: number;
    discountPercent: number;
    discountedPrice: number;
    rechargeRatio: number;
    defaultQuota: number;
    dailyQuota: number | null;
  }> {
    const originalPrice = normalizePriceValue(input.originalPrice);
    const discountPercent = normalizeDiscountPercentValue(input.discountPercent);
    const rechargeRatio = normalizePriceValue(await this.configService.getRechargeRatio());
    const discountedPrice = normalizePriceValue((originalPrice * discountPercent) / 100);
    const defaultQuota = normalizeQuotaValue(originalPrice * rechargeRatio, "amount");
    const dailyQuota = input.dailyQuota == null ? null : normalizeQuotaValue(input.dailyQuota, "amount");

    validatePriceValue("originalPrice", originalPrice);
    validateDiscountPercentValue(discountPercent);
    validatePriceValue("rechargeRatio", rechargeRatio);
    validatePriceValue("discountedPrice", discountedPrice, { allowZero: true });
    validateQuotaValue("defaultQuota", defaultQuota, "amount");

    if (dailyQuota != null) {
      validateQuotaValue("dailyQuota", dailyQuota, "amount");
      if (dailyQuota > defaultQuota) throw new BadRequestError("dailyQuota cannot exceed defaultQuota");
    }

    return {
      originalPrice,
      discountPercent,
      discountedPrice,
      rechargeRatio,
      defaultQuota,
      dailyQuota,
    };
  }

  private async enforceTemplatePurchaseLimit(
    userId: string,
    template: {
      id: string;
      purchaseLimitPerUser: number | null;
      purchaseLimitWindowDays: number | null;
    },
  ): Promise<void> {
    if (template.purchaseLimitPerUser == null || template.purchaseLimitWindowDays == null) return;

    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - template.purchaseLimitWindowDays);

    const currentCount = await this.monthlyPassRepository.countUserPassesByUserAndTemplateSince(
      userId,
      template.id,
      windowStart,
    );

    if (currentCount >= template.purchaseLimitPerUser)
      throw new BadRequestError(
        `purchase limit exceeded: at most ${template.purchaseLimitPerUser} claim(s) per ${template.purchaseLimitWindowDays} day(s)`,
      );
  }

  private toUserPassDto(
    record: {
      id: string;
      userId: string;
      templateId: string;
      startAt: Date;
      endAt: Date;
      totalQuota: DecimalLike;
      dailyQuota: DecimalLike | null;
      quotaUnit: string;
      quotaWindowHours: number | null;
      quotaWindows?: Array<{ id: string; quotaLimit: DecimalLike; quotaUnit: string; quotaWindowHours: DecimalLike }>;
      usedQuota: DecimalLike;
      remainingQuota: DecimalLike;
      assignedBy: string | null;
      note: string | null;
      status: number;
      createTime: Date;
      updateTime: Date;
      template: {
        name: string;
        description: string | null;
        allowedModels: string | null;
        allowedChannels: string | null;
      };
      user: { username: string };
    },
    channelNameById?: Map<string, string>,
    usageSummaryByQuotaWindowKey?: Record<
      string,
      { coveredAmount: number; coveredRequests: number; coveredTokens: number }
    >,
  ): UserMonthlyPassDto {
    const allowedChannelIds = parseAllowedChannels(record.template.allowedChannels) || undefined;
    const allowedChannels = allowedChannelIds
      ? allowedChannelIds.map((channelId) => channelNameById?.get(channelId) || channelId)
      : undefined;

    const quotaWindows =
      record.quotaWindows && record.quotaWindows.length > 0
        ? record.quotaWindows.map((item) => {
            const quotaUnit = normalizeQuotaUnit(item.quotaUnit);
            const usageSummary =
              usageSummaryByQuotaWindowKey?.[
                getQuotaWindowUsageKey(record.id, quotaUnit, Number(item.quotaWindowHours))
              ];

            return this.toQuotaWindowDto(item, usageSummary);
          })
        : this.synthesizeLegacyQuotaWindows(
            record.dailyQuota == null ? null : Number(record.dailyQuota),
            normalizeQuotaUnit(record.quotaUnit),
            record.quotaWindowHours == null ? null : Number(record.quotaWindowHours),
          ).map((item, index) => {
            const usageSummary =
              usageSummaryByQuotaWindowKey?.[getQuotaWindowUsageKey(record.id, item.quotaUnit, item.quotaWindowHours)];
            const usedQuota = usageSummary
              ? normalizeQuotaValue(getWindowConsumed(usageSummary, item.quotaUnit), item.quotaUnit)
              : undefined;

            return {
              id: `legacy-user-window-${record.id}-${index}`,
              quotaLimit: item.quotaLimit,
              quotaUnit: item.quotaUnit,
              quotaWindowHours: item.quotaWindowHours,
              usedQuota,
              remainingQuota:
                usedQuota !== undefined
                  ? normalizeQuotaValue(Math.max(item.quotaLimit - usedQuota, 0), item.quotaUnit)
                  : undefined,
              quotaUsagePercent: usedQuota !== undefined ? (usedQuota / item.quotaLimit) * 100 : undefined,
              isQuotaExceeded: usedQuota !== undefined ? usedQuota >= item.quotaLimit : undefined,
            };
          });

    return {
      id: record.id,
      userId: record.userId,
      username: record.user?.username || undefined,
      templateId: record.templateId,
      templateName: record.template.name,
      templateDescription: record.template.description || undefined,
      allowedModels: parseAllowedModels(record.template.allowedModels) || undefined,
      allowedChannels,
      startAt: record.startAt,
      endAt: record.endAt,
      totalQuota: Number(record.totalQuota),
      dailyQuota: record.dailyQuota == null ? undefined : Number(record.dailyQuota),
      quotaUnit: normalizeQuotaUnit(record.quotaUnit),
      quotaWindowHours: record.quotaWindowHours == null ? undefined : Number(record.quotaWindowHours),
      quotaWindows,
      usedQuota: Number(record.usedQuota),
      remainingQuota: Number(record.remainingQuota),
      assignedBy: record.assignedBy || undefined,
      note: record.note || undefined,
      status: record.status,
      createTime: record.createTime,
      updateTime: record.updateTime,
    };
  }

  private toUsageDto(record: {
    id: string;
    userMonthlyPassId: string;
    userId: string;
    relayUsageId: string | null;
    model: string | null;
    channelName: string | null;
    displayChannelId: string | null;
    displayChannelName: string | null;
    coveredAmount: DecimalLike;
    coveredRequests: number;
    coveredTokens: number;
    totalRequestCost: DecimalLike;
    remainingRequestCost: DecimalLike;
    description: string | null;
    createTime: Date;
    userMonthlyPass: { template: { id: string; name: string } };
  }): MonthlyPassUsageDto {
    const legacyChannelName = record.channelName?.trim();
    return {
      id: record.id,
      userMonthlyPassId: record.userMonthlyPassId,
      userId: record.userId,
      templateId: record.userMonthlyPass.template.id,
      templateName: record.userMonthlyPass.template.name,
      relayUsageId: record.relayUsageId || undefined,
      model: record.model || undefined,
      displayChannelId: legacyChannelName ? undefined : record.displayChannelId || undefined,
      displayChannelName: legacyChannelName || normalizeRelayDisplaySnapshotName(record.displayChannelName),
      coveredAmount: Number(record.coveredAmount),
      coveredRequests: record.coveredRequests || undefined,
      coveredTokens: record.coveredTokens || undefined,
      totalRequestCost: Number(record.totalRequestCost),
      remainingRequestCost: Number(record.remainingRequestCost),
      description: record.description || undefined,
      createTime: record.createTime,
    };
  }

  private toTemplateFilterOption(record: MonthlyPassTemplateDto): MonthlyPassTemplateFilterOptionDto {
    return {
      id: record.id,
      name: record.name,
      publishStatus: record.publishStatus,
      status: record.status,
    };
  }

  private async validateTemplateScope(
    allowedModels: string[] | null | undefined,
    allowedChannels: string[] | null | undefined,
    actorUserId: string,
  ): Promise<void> {
    const modelNames = [...new Set((allowedModels ?? []).map((item) => item.trim()).filter(Boolean))];
    const channelIds = [...new Set((allowedChannels ?? []).map((item) => item.trim()).filter(Boolean))];
    if (modelNames.length === 0 && channelIds.length === 0) return;

    const [modelRecords, channelOptions] = await Promise.all([
      this.modelPricingRepository.listActiveOrderedByModel(),
      channelIds.length > 0 ? this.relayChannelService.listChannelOptions(actorUserId) : Promise.resolve([]),
    ]);
    const activeModelNames = new Set(modelRecords.map((item) => item.model.trim()).filter(Boolean));
    const unknownModels = modelNames.filter((modelName) => !activeModelNames.has(modelName));
    if (unknownModels.length > 0)
      throw new BadRequestError(`Unknown or inactive monthly pass models: ${unknownModels.join(", ")}`);

    if (channelIds.length === 0) return;

    const optionById = new Map(channelOptions.map((option) => [option.id, option]));
    const invalidChannelIds = channelIds.filter((channelId) => !optionById.has(channelId));
    if (invalidChannelIds.length > 0)
      throw new BadRequestError(
        `Unknown, inactive, or inaccessible monthly pass channels: ${invalidChannelIds.join(", ")}`,
      );

    const selectedOptions = channelIds.map((channelId) => optionById.get(channelId)!);
    const unusableChannelIds = selectedOptions
      .filter((option) => option.modelCapabilities.length === 0)
      .map((option) => option.id);
    if (unusableChannelIds.length > 0)
      throw new BadRequestError(
        `Monthly pass channels have no usable model capabilities: ${unusableChannelIds.join(", ")}`,
      );

    if (modelNames.length === 0) return;

    const selectedModelNames = new Set(modelNames);
    const supportedModelNames = new Set(
      selectedOptions.flatMap((option) => option.modelCapabilities.map((capability) => capability.catalogModelName)),
    );
    const unsupportedModels = modelNames.filter((modelName) => !supportedModelNames.has(modelName));
    if (unsupportedModels.length > 0)
      throw new BadRequestError(
        `Monthly pass models are unavailable through the selected channels: ${unsupportedModels.join(", ")}`,
      );

    const incompatibleChannelIds = selectedOptions
      .filter(
        (option) => !option.modelCapabilities.some((capability) => selectedModelNames.has(capability.catalogModelName)),
      )
      .map((option) => option.id);
    if (incompatibleChannelIds.length > 0)
      throw new BadRequestError(
        `Monthly pass channels do not support any selected model: ${incompatibleChannelIds.join(", ")}`,
      );
  }

  async getFilterOptions(actorUserId: string): Promise<MonthlyPassFilterOptionsDto> {
    const [templateResult, modelRecords, relayChannels, groups] = await Promise.all([
      this.listTemplates(1, MONTHLY_PASS_MAX_PAGE_SIZE),
      this.modelPricingRepository.listActiveOrderedByModel(),
      this.relayChannelService.listChannelOptions(actorUserId),
      this.getVisibleGroupOptions(actorUserId),
    ]);

    const models = Array.from(new Set(modelRecords.map((item) => item.model).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b),
    );

    const channels = relayChannels
      .map((item) => ({
        value: item.id,
        label: item.name ? `${item.name} (${item.id})` : item.id,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return {
      templateStatusOptions: DEFAULT_NUMBER_STATUS_OPTIONS,
      assignmentStatusOptions: DEFAULT_NUMBER_STATUS_OPTIONS,
      publishStatusOptions: DEFAULT_PUBLISH_STATUS_OPTIONS,
      assignmentModeOptions: DEFAULT_ASSIGNMENT_MODE_OPTIONS,
      quotaUnitOptions: DEFAULT_QUOTA_UNIT_OPTIONS,
      templates: templateResult.records.map((item) => this.toTemplateFilterOption(item)),
      models,
      channels,
      groups,
    };
  }

  private async getVisibleGroupOptions(actorUserId: string): Promise<MonthlyPassGroupFilterOptionDto[]> {
    const visibleLevel = await this.getVisibleUserLevel(actorUserId);
    const groups =
      visibleLevel == null
        ? await this.groupRepository.listActiveWithUserCount()
        : await this.groupRepository.listVisibleWithUserCount(visibleLevel);

    return groups
      .map((item) => ({
        id: item.id,
        username: item.username,
        name: item.name || item.username,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async createTemplate(
    data: CreateMonthlyPassTemplateRequest,
    actorUserId: string,
    request?: Request,
  ): Promise<MonthlyPassTemplateDto> {
    const name = data.name.trim();
    const existed = await this.monthlyPassRepository.findTemplateByName(name);
    if (existed) throw new BadRequestError("Monthly pass template name already exists");

    await this.validateTemplateScope(data.allowedModels, data.allowedChannels, actorUserId);

    const hasPricingInput = data.originalPrice !== undefined || data.discountPercent !== undefined;
    const quotaWindowHours = normalizeQuotaWindowHours(data.quotaWindowHours, true);
    const purchaseLimitConfig = validatePurchaseLimitConfig(data.purchaseLimitPerUser, data.purchaseLimitWindowDays);

    const record = hasPricingInput
      ? await (async () => {
          if (data.originalPrice == null || data.discountPercent == null)
            throw new BadRequestError("originalPrice and discountPercent are required to derive monthly pass pricing");

          const derivedPricing = await this.deriveTemplatePricing({
            originalPrice: data.originalPrice,
            discountPercent: data.discountPercent,
            dailyQuota: data.dailyQuota,
          });

          const resolvedQuotaWindowHours =
            derivedPricing.dailyQuota != null
              ? (quotaWindowHours ?? MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS)
              : quotaWindowHours;

          const quotaWindows = this.resolveQuotaWindowsForPersist({
            explicitQuotaWindows: data.quotaWindows,
            dailyQuota: derivedPricing.dailyQuota,
            quotaUnit: "amount",
            quotaWindowHours: resolvedQuotaWindowHours,
          });

          return this.monthlyPassRepository.createTemplate(
            {
              name,
              description: data.description || null,
              publishStatus: "draft",
              publishedAt: null,
              allowBalanceRedemption: data.allowBalanceRedemption ?? true,
              purchaseLimitPerUser: purchaseLimitConfig.purchaseLimitPerUser ?? null,
              purchaseLimitWindowDays: purchaseLimitConfig.purchaseLimitWindowDays ?? null,
              originalPrice: derivedPricing.originalPrice,
              discountPercent: derivedPricing.discountPercent,
              discountedPrice: derivedPricing.discountedPrice,
              rechargeRatio: derivedPricing.rechargeRatio,
              defaultQuota: derivedPricing.defaultQuota,
              dailyQuota: derivedPricing.dailyQuota,
              quotaUnit: "amount",
              quotaWindowHours: resolvedQuotaWindowHours,
              allowedModels: serializeStringArray(data.allowedModels),
              allowedChannels: serializeStringArray(data.allowedChannels),
              status: MANAGED_STATUS.ENABLED,
            },
            quotaWindows,
          );
        })()
      : await (async () => {
          if (data.defaultQuota == null)
            throw new BadRequestError("defaultQuota is required when not using price-first monthly pass templates");

          const quotaUnit = normalizeQuotaUnit(data.quotaUnit);
          validateQuotaValue("defaultQuota", data.defaultQuota, quotaUnit);

          const defaultQuota = normalizeQuotaValue(data.defaultQuota, quotaUnit);
          const dailyQuota = data.dailyQuota == null ? null : normalizeQuotaValue(data.dailyQuota, quotaUnit);

          if (dailyQuota != null) {
            validateQuotaValue("dailyQuota", dailyQuota, quotaUnit);
            if (dailyQuota > defaultQuota) throw new BadRequestError("dailyQuota cannot exceed defaultQuota");
          }

          const resolvedQuotaWindowHours =
            dailyQuota != null ? (quotaWindowHours ?? MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS) : quotaWindowHours;

          const quotaWindows = this.resolveQuotaWindowsForPersist({
            explicitQuotaWindows: data.quotaWindows,
            dailyQuota,
            quotaUnit,
            quotaWindowHours: resolvedQuotaWindowHours,
          });

          return this.monthlyPassRepository.createTemplate(
            {
              name,
              description: data.description || null,
              publishStatus: "draft",
              publishedAt: null,
              allowBalanceRedemption: data.allowBalanceRedemption ?? true,
              purchaseLimitPerUser: purchaseLimitConfig.purchaseLimitPerUser ?? null,
              purchaseLimitWindowDays: purchaseLimitConfig.purchaseLimitWindowDays ?? null,
              originalPrice: null,
              discountPercent: null,
              discountedPrice: null,
              rechargeRatio: null,
              defaultQuota,
              dailyQuota,
              quotaUnit,
              quotaWindowHours: resolvedQuotaWindowHours,
              allowedModels: serializeStringArray(data.allowedModels),
              allowedChannels: serializeStringArray(data.allowedChannels),
              status: MANAGED_STATUS.ENABLED,
            },
            quotaWindows,
          );
        })();

    await this.businessLogService.logOperation({
      operationType: OperationType.MONTHLY_PASS_TEMPLATE_CREATE,
      operationCategory: OperationCategory.BILLING,
      actorUserId,
      targetResourceId: record.id,
      targetResourceType: "MONTHLY_PASS_TEMPLATE",
      description: `创建了月卡模板 '${record.name}'`,
      changes: data,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toTemplateDto(record);
  }

  async publishTemplate(id: string, actorUserId: string, request?: Request): Promise<MonthlyPassTemplateDto> {
    const existing = await this.monthlyPassRepository.findTemplateById(id);
    if (!existing || existing.status < MANAGED_STATUS.DISABLED)
      throw new NotFoundError("Monthly pass template not found");

    if (normalizeTemplatePublishStatus(existing.publishStatus) === "published")
      throw new BadRequestError("Monthly pass template is already published");

    await this.validateTemplateScope(
      parseAllowedModels(existing.allowedModels),
      parseAllowedChannels(existing.allowedChannels),
      actorUserId,
    );

    const record = await this.monthlyPassRepository.updateTemplate(id, {
      publishStatus: "published",
      publishedAt: new Date(),
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.MONTHLY_PASS_TEMPLATE_PUBLISH,
      operationCategory: OperationCategory.BILLING,
      actorUserId,
      targetResourceId: record.id,
      targetResourceType: "MONTHLY_PASS_TEMPLATE",
      description: `发布了月卡模板 '${record.name}'`,
      changes: { publishStatus: "published" },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toTemplateDto(record);
  }

  async unpublishTemplate(id: string, actorUserId: string, request?: Request): Promise<MonthlyPassTemplateDto> {
    const existing = await this.monthlyPassRepository.findTemplateById(id);
    if (!existing || existing.status < MANAGED_STATUS.DISABLED)
      throw new NotFoundError("Monthly pass template not found");

    if (normalizeTemplatePublishStatus(existing.publishStatus) === "draft")
      throw new BadRequestError("Monthly pass template is already unpublished");

    const record = await this.monthlyPassRepository.updateTemplate(id, {
      publishStatus: "draft",
      publishedAt: null,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.MONTHLY_PASS_TEMPLATE_UNPUBLISH,
      operationCategory: OperationCategory.BILLING,
      actorUserId,
      targetResourceId: record.id,
      targetResourceType: "MONTHLY_PASS_TEMPLATE",
      description: `下架了月卡模板 '${record.name}'`,
      changes: { publishStatus: "draft" },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toTemplateDto(record);
  }

  async updateTemplate(
    id: string,
    data: UpdateMonthlyPassTemplateRequest,
    actorUserId: string,
    request?: Request,
  ): Promise<MonthlyPassTemplateDto> {
    const existing = await this.monthlyPassRepository.findTemplateById(id);
    if (!existing || existing.status < MANAGED_STATUS.DISABLED)
      throw new NotFoundError("Monthly pass template not found");

    if (data.name && data.name.trim() !== existing.name) {
      const conflict = await this.monthlyPassRepository.findTemplateByName(data.name.trim());
      if (conflict && conflict.id !== id) throw new BadRequestError("Monthly pass template name already exists");
    }

    await this.validateTemplateScope(
      data.allowedModels === undefined ? parseAllowedModels(existing.allowedModels) : data.allowedModels,
      data.allowedChannels === undefined ? parseAllowedChannels(existing.allowedChannels) : data.allowedChannels,
      actorUserId,
    );

    const hasPricingUpdate = data.originalPrice !== undefined || data.discountPercent !== undefined;
    const isExistingPriceFirst = isPriceFirstTemplateRecord(existing);
    const finalIsPriceFirst = isExistingPriceFirst || hasPricingUpdate;
    const existingOriginalPrice = existing.originalPrice == null ? null : Number(existing.originalPrice);
    const existingDiscountPercent = existing.discountPercent == null ? null : Number(existing.discountPercent);
    const existingDailyQuota = existing.dailyQuota == null ? null : Number(existing.dailyQuota);
    const existingDefaultQuota = Number(existing.defaultQuota);
    const existingQuotaUnit = normalizeQuotaUnit(existing.quotaUnit);

    let derivedPricing:
      | {
          originalPrice: number;
          discountPercent: number;
          discountedPrice: number;
          rechargeRatio: number;
          defaultQuota: number;
          dailyQuota: number | null;
        }
      | undefined;

    if (finalIsPriceFirst && data.defaultQuota !== undefined)
      throw new BadRequestError("defaultQuota cannot be provided when updating price-first monthly pass templates");

    if (finalIsPriceFirst && data.quotaUnit !== undefined && data.quotaUnit !== "amount")
      throw new BadRequestError("quotaUnit must be amount for price-first monthly pass templates");

    if (hasPricingUpdate) {
      const finalOriginalPrice = data.originalPrice ?? existingOriginalPrice;
      const finalDiscountPercent = data.discountPercent ?? existingDiscountPercent;

      if (finalOriginalPrice == null || finalDiscountPercent == null)
        throw new BadRequestError("originalPrice and discountPercent are required to derive monthly pass pricing");

      derivedPricing = await this.deriveTemplatePricing({
        originalPrice: finalOriginalPrice,
        discountPercent: finalDiscountPercent,
        dailyQuota: data.dailyQuota === undefined ? existingDailyQuota : data.dailyQuota,
      });
    }

    const shouldUseLegacyQuotaPath = !finalIsPriceFirst;

    let normalizedQuotaWindowHours =
      data.quotaWindowHours === undefined ? undefined : normalizeQuotaWindowHours(data.quotaWindowHours, true);

    let purchaseLimitConfig:
      | { purchaseLimitPerUser: number | null | undefined; purchaseLimitWindowDays: number | null | undefined }
      | undefined;

    if (data.purchaseLimitPerUser !== undefined || data.purchaseLimitWindowDays !== undefined) {
      const finalLimit =
        data.purchaseLimitPerUser !== undefined ? data.purchaseLimitPerUser : existing.purchaseLimitPerUser;
      const finalWindow =
        data.purchaseLimitWindowDays !== undefined ? data.purchaseLimitWindowDays : existing.purchaseLimitWindowDays;
      purchaseLimitConfig = validatePurchaseLimitConfig(finalLimit, finalWindow);
    }

    let updatePayload: Prisma.MonthlyPassTemplateUncheckedUpdateInput;
    let quotaWindowsForUpdate: MonthlyPassQuotaWindowInput[] | undefined;

    if (derivedPricing) {
      const finalDailyQuota = data.dailyQuota === undefined ? derivedPricing.dailyQuota : derivedPricing.dailyQuota;

      if (finalDailyQuota != null && normalizedQuotaWindowHours === undefined) {
        const existingQuotaWindowHours = normalizeQuotaWindowHours(existing.quotaWindowHours);
        if (existingQuotaWindowHours == null) normalizedQuotaWindowHours = MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS;
      }

      updatePayload = {
        name: data.name?.trim(),
        description: data.description,
        allowBalanceRedemption: data.allowBalanceRedemption,
        purchaseLimitPerUser:
          purchaseLimitConfig === undefined ? undefined : (purchaseLimitConfig.purchaseLimitPerUser ?? null),
        purchaseLimitWindowDays:
          purchaseLimitConfig === undefined ? undefined : (purchaseLimitConfig.purchaseLimitWindowDays ?? null),
        originalPrice: derivedPricing.originalPrice,
        discountPercent: derivedPricing.discountPercent,
        discountedPrice: derivedPricing.discountedPrice,
        rechargeRatio: derivedPricing.rechargeRatio,
        defaultQuota: derivedPricing.defaultQuota,
        dailyQuota: finalDailyQuota,
        quotaUnit: "amount",
        quotaWindowHours: normalizedQuotaWindowHours,
        allowedModels: data.allowedModels === undefined ? undefined : serializeStringArray(data.allowedModels),
        allowedChannels: data.allowedChannels === undefined ? undefined : serializeStringArray(data.allowedChannels),
        status: data.status,
      };

      quotaWindowsForUpdate = this.resolveQuotaWindowsForPersist({
        explicitQuotaWindows: data.quotaWindows,
        dailyQuota: finalDailyQuota,
        quotaUnit: "amount",
        quotaWindowHours: normalizedQuotaWindowHours,
      });
    } else if (shouldUseLegacyQuotaPath) {
      const finalQuotaUnit = normalizeQuotaUnit(data.quotaUnit ?? existingQuotaUnit);
      const finalDefaultQuota =
        data.defaultQuota === undefined ? existingDefaultQuota : normalizeQuotaValue(data.defaultQuota, finalQuotaUnit);
      validateQuotaValue("defaultQuota", finalDefaultQuota, finalQuotaUnit);

      const finalDailyQuota =
        data.dailyQuota === undefined
          ? existingDailyQuota
          : data.dailyQuota == null
            ? null
            : normalizeQuotaValue(data.dailyQuota, finalQuotaUnit);

      if (finalDailyQuota != null) {
        validateQuotaValue("dailyQuota", finalDailyQuota, finalQuotaUnit);
        if (finalDailyQuota > finalDefaultQuota) throw new BadRequestError("dailyQuota cannot exceed defaultQuota");
      }

      if (finalDailyQuota != null && normalizedQuotaWindowHours === undefined) {
        const existingQuotaWindowHours = normalizeQuotaWindowHours(existing.quotaWindowHours);
        if (existingQuotaWindowHours == null) normalizedQuotaWindowHours = MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS;
      }

      updatePayload = {
        name: data.name?.trim(),
        description: data.description,
        allowBalanceRedemption: data.allowBalanceRedemption,
        purchaseLimitPerUser:
          purchaseLimitConfig === undefined ? undefined : (purchaseLimitConfig.purchaseLimitPerUser ?? null),
        purchaseLimitWindowDays:
          purchaseLimitConfig === undefined ? undefined : (purchaseLimitConfig.purchaseLimitWindowDays ?? null),
        originalPrice: null,
        discountPercent: null,
        discountedPrice: null,
        rechargeRatio: null,
        defaultQuota: finalDefaultQuota,
        dailyQuota: finalDailyQuota,
        quotaUnit: finalQuotaUnit,
        quotaWindowHours: normalizedQuotaWindowHours,
        allowedModels: data.allowedModels === undefined ? undefined : serializeStringArray(data.allowedModels),
        allowedChannels: data.allowedChannels === undefined ? undefined : serializeStringArray(data.allowedChannels),
        status: data.status,
      };

      quotaWindowsForUpdate = this.resolveQuotaWindowsForPersist({
        explicitQuotaWindows: data.quotaWindows,
        dailyQuota: finalDailyQuota,
        quotaUnit: finalQuotaUnit,
        quotaWindowHours: normalizedQuotaWindowHours,
      });
    } else {
      const finalDailyQuota =
        data.dailyQuota === undefined
          ? existingDailyQuota
          : data.dailyQuota == null
            ? null
            : normalizeQuotaValue(data.dailyQuota, "amount");

      if (finalDailyQuota != null) {
        validateQuotaValue("dailyQuota", finalDailyQuota, "amount");
        if (finalDailyQuota > existingDefaultQuota) throw new BadRequestError("dailyQuota cannot exceed defaultQuota");
      }

      if (finalDailyQuota != null && normalizedQuotaWindowHours === undefined) {
        const existingQuotaWindowHours = normalizeQuotaWindowHours(existing.quotaWindowHours);
        if (existingQuotaWindowHours == null) normalizedQuotaWindowHours = MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS;
      }

      updatePayload = {
        name: data.name?.trim(),
        description: data.description,
        allowBalanceRedemption: data.allowBalanceRedemption,
        purchaseLimitPerUser:
          purchaseLimitConfig === undefined ? undefined : (purchaseLimitConfig.purchaseLimitPerUser ?? null),
        purchaseLimitWindowDays:
          purchaseLimitConfig === undefined ? undefined : (purchaseLimitConfig.purchaseLimitWindowDays ?? null),
        dailyQuota: finalDailyQuota,
        quotaWindowHours: normalizedQuotaWindowHours,
        allowedModels: data.allowedModels === undefined ? undefined : serializeStringArray(data.allowedModels),
        allowedChannels: data.allowedChannels === undefined ? undefined : serializeStringArray(data.allowedChannels),
        status: data.status,
      };

      if (data.quotaWindows !== undefined || data.dailyQuota !== undefined || data.quotaWindowHours !== undefined)
        quotaWindowsForUpdate = this.resolveQuotaWindowsForPersist({
          explicitQuotaWindows: data.quotaWindows,
          dailyQuota: finalDailyQuota,
          quotaUnit: "amount",
          quotaWindowHours: normalizedQuotaWindowHours ?? normalizeQuotaWindowHours(existing.quotaWindowHours),
        });
    }

    const record = await this.monthlyPassRepository.updateTemplate(id, updatePayload, quotaWindowsForUpdate);

    await this.businessLogService.logOperation({
      operationType: OperationType.MONTHLY_PASS_TEMPLATE_UPDATE,
      operationCategory: OperationCategory.BILLING,
      actorUserId,
      targetResourceId: record.id,
      targetResourceType: "MONTHLY_PASS_TEMPLATE",
      description: `更新了月卡模板 '${record.name}'`,
      changes: data,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toTemplateDto(record);
  }

  async deleteTemplate(id: string, actorUserId: string, request?: Request): Promise<void> {
    const existing = await this.monthlyPassRepository.findTemplateById(id);
    if (!existing || existing.status < MANAGED_STATUS.DISABLED)
      throw new NotFoundError("Monthly pass template not found");

    await this.monthlyPassRepository.softDeleteTemplate(id);

    await this.businessLogService.logOperation({
      operationType: OperationType.MONTHLY_PASS_TEMPLATE_DELETE,
      operationCategory: OperationCategory.BILLING,
      actorUserId,
      targetResourceId: existing.id,
      targetResourceType: "MONTHLY_PASS_TEMPLATE",
      description: `删除了月卡模板 '${existing.name}'`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  async listTemplates(
    page?: number,
    pageSize?: number,
    status?: number,
    keyword?: string,
  ): Promise<MonthlyPassTemplateListResponse> {
    const paging = normalizePagination(page, pageSize);

    const where: Prisma.MonthlyPassTemplateWhereInput = {};
    if (status !== undefined) where.status = status;
    else where.status = { gte: MANAGED_STATUS.DISABLED };

    if (keyword) where.OR = [{ name: { contains: keyword } }, { description: { contains: keyword } }];

    const result = await this.monthlyPassRepository.listTemplates(where, paging.page, paging.pageSize);

    return {
      total: result.total,
      records: result.records.map((item) => this.toTemplateDto(item)),
      page: paging.page,
      pageSize: paging.pageSize,
    };
  }

  async listPublishedTemplates(): Promise<MonthlyPassTemplateDto[]> {
    const records = await this.monthlyPassRepository.listPublishedTemplates();
    return records.map((item) => this.toTemplateDto(item));
  }

  async claimPublishedTemplate(
    data: ClaimMonthlyPassTemplateRequest,
    actorUserId: string,
    request?: Request,
  ): Promise<ClaimMonthlyPassResultDto> {
    const template = await this.monthlyPassRepository.findTemplateById(data.templateId);
    if (!template || template.status !== MANAGED_STATUS.ENABLED)
      throw new NotFoundError("Monthly pass template not found");

    if (normalizeTemplatePublishStatus(template.publishStatus) !== "published")
      throw new BadRequestError("Monthly pass template is not published");

    if (!template.allowBalanceRedemption)
      throw new BadRequestError("Monthly pass template does not allow balance redemption");

    const discountedPrice = template.discountedPrice == null ? null : Number(template.discountedPrice);
    if (discountedPrice == null)
      throw new BadRequestError("Monthly pass template cannot be redeemed by balance");

    validatePriceValue("discountedPrice", discountedPrice, { allowZero: true });

    const rechargeRatio = normalizePriceValue(await this.configService.getRechargeRatio());
    validatePriceValue("rechargeRatio", rechargeRatio);
    const purchaseAmount = normalizePriceValue(discountedPrice * rechargeRatio);
    validatePriceValue("discountedPrice", purchaseAmount, { allowZero: true });

    const quotaUnit = normalizeQuotaUnit(template.quotaUnit);
    const totalQuota = normalizeQuotaValue(Number(template.defaultQuota), quotaUnit);
    const dailyQuota = template.dailyQuota == null ? null : normalizeQuotaValue(Number(template.dailyQuota), quotaUnit);
    const quotaWindowHours =
      dailyQuota != null
        ? normalizeQuotaWindowHours(template.quotaWindowHours ?? MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS, true)
        : normalizeQuotaWindowHours(template.quotaWindowHours);

    const quotaWindows = this.resolveQuotaWindowsForPersist({
      explicitQuotaWindows: template.quotaWindows?.map((item) => ({
        quotaLimit: Number(item.quotaLimit),
        quotaUnit: normalizeQuotaUnit(item.quotaUnit),
        quotaWindowHours: Number(item.quotaWindowHours),
      })),
      dailyQuota,
      quotaUnit,
      quotaWindowHours,
    });

    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + MONTHLY_PASS_SELF_CLAIM_DURATION_DAYS * 24 * 60 * 60 * 1000);

    const record = await this.monthlyPassRepository.purchaseUserPass(
      {
        userId: actorUserId,
        templateId: template.id,
        startAt,
        endAt,
        totalQuota,
        dailyQuota,
        quotaUnit,
        quotaWindowHours,
        usedQuota: 0,
        remainingQuota: totalQuota,
        assignedBy: actorUserId,
        note: "self-claimed",
        status: MANAGED_STATUS.ENABLED,
      },
      quotaWindows,
      {
        userId: actorUserId,
        purchaseAmount,
        templateName: template.name,
        templateId: template.id,
        limit:
          template.purchaseLimitPerUser != null && template.purchaseLimitWindowDays != null
            ? {
                maximum: template.purchaseLimitPerUser,
                windowStart: new Date(Date.now() - template.purchaseLimitWindowDays * 24 * 60 * 60 * 1000),
              }
            : undefined,
      },
    );

    await this.businessLogService.logOperation({
      operationType: OperationType.MONTHLY_PASS_SELF_CLAIM,
      operationCategory: OperationCategory.BILLING,
      actorUserId,
      targetUserId: actorUserId,
      targetResourceId: record.id,
      targetResourceType: "USER_MONTHLY_PASS",
      description: `用户自助购买月卡 '${record.template.name}'`,
      changes: { templateId: data.templateId, purchaseAmount },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return {
      purchaseAmount,
      userPass: this.toUserPassDto(record),
    };
  }

  async assignUserPass(
    data: AssignUserMonthlyPassRequest,
    assignedBy: string,
    request?: Request,
  ): Promise<UserMonthlyPassDto> {
    const startAt = parseRequiredDateStringOrThrow("startAt", data.startAt);
    const endAt = parseRequiredDateStringOrThrow("endAt", data.endAt);

    const [user, template] = await Promise.all([
      this.userRepository.findById(data.userId),
      this.monthlyPassRepository.findTemplateById(data.templateId),
    ]);

    if (!user || user.status < AccountStatus.DISABLED) throw new NotFoundError("User not found");
    if (!template || template.status !== MANAGED_STATUS.ENABLED)
      throw new NotFoundError("Monthly pass template not found");

    if (endAt.getTime() <= startAt.getTime()) throw new BadRequestError("endAt must be later than startAt");

    const quotaUnit = normalizeQuotaUnit(data.quotaUnit ?? template.quotaUnit);

    if (data.totalQuota !== undefined) validateQuotaValue("totalQuota", data.totalQuota, quotaUnit);
    if (data.dailyQuota !== undefined) validateQuotaValue("dailyQuota", data.dailyQuota, quotaUnit);

    const totalQuota = normalizeQuotaValue(data.totalQuota ?? Number(template.defaultQuota), quotaUnit);
    validateQuotaValue("totalQuota", totalQuota, quotaUnit);

    const dailyQuota =
      data.dailyQuota === undefined
        ? template.dailyQuota == null
          ? null
          : normalizeQuotaValue(Number(template.dailyQuota), quotaUnit)
        : normalizeQuotaValue(data.dailyQuota, quotaUnit);
    if (dailyQuota != null) {
      validateQuotaValue("dailyQuota", dailyQuota, quotaUnit);

      if (dailyQuota > totalQuota) throw new BadRequestError("dailyQuota cannot exceed totalQuota");
    }

    const templateQuotaWindowHours = normalizeQuotaWindowHours(template.quotaWindowHours);
    const requestedQuotaWindowHours =
      data.quotaWindowHours === undefined ? undefined : normalizeQuotaWindowHours(data.quotaWindowHours, true);
    const quotaWindowHours =
      requestedQuotaWindowHours ??
      (dailyQuota != null
        ? (templateQuotaWindowHours ?? MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS)
        : templateQuotaWindowHours);

    const quotaWindows = this.resolveQuotaWindowsForPersist({
      explicitQuotaWindows: data.quotaWindows,
      dailyQuota,
      quotaUnit,
      quotaWindowHours,
    });

    const record = await this.monthlyPassRepository.createUserPass(
      {
        userId: data.userId,
        templateId: data.templateId,
        startAt,
        endAt,
        totalQuota,
        dailyQuota,
        quotaUnit,
        quotaWindowHours,
        usedQuota: 0,
        remainingQuota: totalQuota,
        assignedBy,
        note: data.note || null,
        status: MANAGED_STATUS.ENABLED,
      },
      quotaWindows,
    );

    await this.businessLogService.logOperation({
      operationType: OperationType.MONTHLY_PASS_ASSIGNMENT_CREATE,
      operationCategory: OperationCategory.BILLING,
      actorUserId: assignedBy,
      targetUserId: record.userId,
      targetResourceId: record.id,
      targetResourceType: "USER_MONTHLY_PASS",
      description: `为用户 '${record.user.username}' 分配了月卡 '${record.template.name}'`,
      changes: data,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toUserPassDto(record);
  }

  async updateUserPass(
    id: string,
    data: UpdateUserMonthlyPassRequest,
    actorUserId: string,
    request?: Request,
  ): Promise<UserMonthlyPassDto> {
    const existing = await this.monthlyPassRepository.findUserPassById(id);
    if (!existing || existing.status < MANAGED_STATUS.DISABLED) throw new NotFoundError("User monthly pass not found");

    const parsedStartAt =
      data.startAt === undefined ? undefined : parseRequiredDateStringOrThrow("startAt", data.startAt);
    const parsedEndAt = data.endAt === undefined ? undefined : parseRequiredDateStringOrThrow("endAt", data.endAt);

    const finalStartAt = parsedStartAt ?? existing.startAt;
    const finalEndAt = parsedEndAt ?? existing.endAt;
    if (finalEndAt.getTime() <= finalStartAt.getTime()) throw new BadRequestError("endAt must be later than startAt");

    const finalQuotaUnit =
      data.quotaUnit === undefined ? normalizeQuotaUnit(existing.quotaUnit) : normalizeQuotaUnit(data.quotaUnit);

    if (data.totalQuota !== undefined) validateQuotaValue("totalQuota", data.totalQuota, finalQuotaUnit);
    if (data.dailyQuota !== undefined && data.dailyQuota != null)
      validateQuotaValue("dailyQuota", data.dailyQuota, finalQuotaUnit);

    const usedQuota = Number(existing.usedQuota);
    const totalQuota =
      data.totalQuota === undefined
        ? Number(existing.totalQuota)
        : normalizeQuotaValue(data.totalQuota, finalQuotaUnit);
    validateQuotaValue("totalQuota", totalQuota, finalQuotaUnit);

    const existingDailyQuota = existing.dailyQuota == null ? null : Number(existing.dailyQuota);
    const finalDailyQuota =
      data.dailyQuota === undefined
        ? existingDailyQuota
        : data.dailyQuota == null
          ? null
          : normalizeQuotaValue(data.dailyQuota, finalQuotaUnit);
    if (finalDailyQuota != null) {
      validateQuotaValue("dailyQuota", finalDailyQuota, finalQuotaUnit);

      if (finalDailyQuota > totalQuota) throw new BadRequestError("dailyQuota cannot exceed totalQuota");
    }

    if (totalQuota < usedQuota) throw new BadRequestError("totalQuota cannot be less than usedQuota");

    const existingQuotaWindowHours = normalizeQuotaWindowHours(existing.quotaWindowHours);
    const requestedQuotaWindowHours =
      data.quotaWindowHours === undefined ? undefined : normalizeQuotaWindowHours(data.quotaWindowHours, true);
    const finalQuotaWindowHours =
      requestedQuotaWindowHours ??
      (finalDailyQuota != null
        ? (existingQuotaWindowHours ?? MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS)
        : existingQuotaWindowHours);

    const quotaWindowsForUpdate =
      data.quotaWindows !== undefined || data.dailyQuota !== undefined || data.quotaWindowHours !== undefined
        ? this.resolveQuotaWindowsForPersist({
            explicitQuotaWindows: data.quotaWindows,
            dailyQuota: finalDailyQuota,
            quotaUnit: finalQuotaUnit,
            quotaWindowHours: finalQuotaWindowHours,
          })
        : undefined;

    const remainingQuota = isIntegerQuotaUnit(finalQuotaUnit)
      ? Math.max(0, Math.floor(totalQuota - usedQuota))
      : round4(totalQuota - usedQuota);

    const record = await this.monthlyPassRepository.updateUserPass(
      id,
      {
        startAt: parsedStartAt,
        endAt: parsedEndAt,
        totalQuota: data.totalQuota === undefined ? undefined : totalQuota,
        dailyQuota: data.dailyQuota === undefined ? undefined : finalDailyQuota,
        quotaUnit: finalQuotaUnit,
        quotaWindowHours: finalQuotaWindowHours,
        remainingQuota,
        note: data.note,
        status: data.status,
      },
      quotaWindowsForUpdate,
    );

    await this.businessLogService.logOperation({
      operationType: OperationType.MONTHLY_PASS_ASSIGNMENT_UPDATE,
      operationCategory: OperationCategory.BILLING,
      actorUserId,
      targetUserId: record.userId,
      targetResourceId: record.id,
      targetResourceType: "USER_MONTHLY_PASS",
      description: `更新了用户 '${record.user.username}' 的月卡 '${record.template.name}'`,
      changes: data,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toUserPassDto(record);
  }

  async deleteUserPass(id: string, actorUserId: string, request?: Request): Promise<void> {
    const existing = await this.monthlyPassRepository.findUserPassById(id);
    if (!existing || existing.status < MANAGED_STATUS.DISABLED) throw new NotFoundError("User monthly pass not found");

    await this.monthlyPassRepository.softDeleteUserPass(id);

    await this.businessLogService.logOperation({
      operationType: OperationType.MONTHLY_PASS_ASSIGNMENT_DELETE,
      operationCategory: OperationCategory.BILLING,
      actorUserId,
      targetUserId: existing.userId,
      targetResourceId: existing.id,
      targetResourceType: "USER_MONTHLY_PASS",
      description: `删除了用户 '${existing.user.username}' 的月卡 '${existing.template.name}'`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  async listUserPasses(
    page?: number,
    pageSize?: number,
    userId?: string,
    templateId?: string,
    status?: number,
  ): Promise<UserMonthlyPassListResponse> {
    const paging = normalizePagination(page, pageSize);
    const where: Prisma.UserMonthlyPassWhereInput = {};

    if (status !== undefined) where.status = status;
    else where.status = { gte: MANAGED_STATUS.DISABLED };

    if (userId) where.userId = userId;
    if (templateId) where.templateId = templateId;

    const result = await this.monthlyPassRepository.listUserPasses(where, paging.page, paging.pageSize);

    const allChannelIds = Array.from(
      new Set(result.records.flatMap((item) => parseAllowedChannels(item.template.allowedChannels) || [])),
    );

    const channels = await this.relayChannelRepository.listActiveByIds(allChannelIds.slice(0, MAX_CHANNEL_LOOKUP_IDS));
    const channelNameById = new Map(channels.map((item) => [item.id, item.name]));
    const usageSummaryByQuotaWindowKey = await this.getQuotaWindowUsageSummaryMap(result.records, new Date());

    return {
      total: result.total,
      records: result.records.map((item) => this.toUserPassDto(item, channelNameById, usageSummaryByQuotaWindowKey)),
      page: paging.page,
      pageSize: paging.pageSize,
    };
  }

  async assignUserPassBatch(
    data: AssignBatchUserMonthlyPassRequest,
    actorUserId: string,
    request?: Request,
  ): Promise<BatchAssignUserMonthlyPassResponse> {
    const assignmentMode = normalizeAssignmentMode(data.assignmentMode);
    const targets = await this.resolveBatchTargetUsers(actorUserId, data);
    const results: BatchAssignUserMonthlyPassItemDto[] = [];

    for (const target of targets)
      try {
        if (assignmentMode === "extend_existing") {
          const latestPass = await this.monthlyPassRepository.findLatestUserPassByUserAndTemplate(
            target.id,
            data.templateId,
          );

          if (latestPass && latestPass.endAt.getTime() >= new Date(data.startAt).getTime()) {
            const startAt = parseRequiredDateStringOrThrow("startAt", data.startAt);
            const endAt = parseRequiredDateStringOrThrow("endAt", data.endAt);
            const durationMs = endAt.getTime() - startAt.getTime();
            const quotaUnit = normalizeQuotaUnit(data.quotaUnit ?? latestPass.quotaUnit);
            if (normalizeQuotaUnit(latestPass.quotaUnit) !== quotaUnit)
              throw new BadRequestError("Cannot extend a monthly pass with a different quotaUnit");

            const incrementQuota = normalizeQuotaValue(
              data.totalQuota ?? Number(latestPass.template.defaultQuota),
              quotaUnit,
            );
            validateQuotaValue("totalQuota", incrementQuota, quotaUnit);

            const updatedTotalQuota = normalizeQuotaValue(Number(latestPass.totalQuota) + incrementQuota, quotaUnit);
            const updatedRemainingQuota = normalizeQuotaValue(
              Number(latestPass.remainingQuota) + incrementQuota,
              quotaUnit,
            );
            validateQuotaValue("totalQuota", updatedTotalQuota, quotaUnit);

            const dailyQuota =
              data.dailyQuota === undefined
                ? latestPass.dailyQuota == null
                  ? null
                  : Number(latestPass.dailyQuota)
                : normalizeQuotaValue(data.dailyQuota, quotaUnit);

            if (dailyQuota != null) {
              validateQuotaValue("dailyQuota", dailyQuota, quotaUnit);
              if (dailyQuota > updatedTotalQuota) throw new BadRequestError("dailyQuota cannot exceed totalQuota");
            }

            const requestedQuotaWindowHours =
              data.quotaWindowHours === undefined ? undefined : normalizeQuotaWindowHours(data.quotaWindowHours, true);
            const finalQuotaWindowHours =
              requestedQuotaWindowHours ??
              (dailyQuota != null
                ? (normalizeQuotaWindowHours(latestPass.quotaWindowHours) ?? MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS)
                : normalizeQuotaWindowHours(latestPass.quotaWindowHours));

            const quotaWindows = this.resolveQuotaWindowsForPersist({
              explicitQuotaWindows: data.quotaWindows,
              dailyQuota,
              quotaUnit,
              quotaWindowHours: finalQuotaWindowHours,
            });

            const updated = await this.monthlyPassRepository.updateUserPass(
              latestPass.id,
              {
                endAt: new Date(Math.max(latestPass.endAt.getTime(), startAt.getTime()) + durationMs),
                totalQuota: updatedTotalQuota,
                dailyQuota,
                quotaUnit,
                quotaWindowHours: finalQuotaWindowHours,
                remainingQuota: updatedRemainingQuota,
                note: data.note ?? latestPass.note,
              },
              quotaWindows,
            );

            results.push({
              userId: target.id,
              username: target.username,
              userPassId: updated.id,
              result: "extended",
            });
            continue;
          }
        }

        const created = await this.assignUserPass(
          {
            userId: target.id,
            templateId: data.templateId,
            startAt: data.startAt,
            endAt: data.endAt,
            totalQuota: data.totalQuota,
            dailyQuota: data.dailyQuota,
            quotaUnit: data.quotaUnit,
            quotaWindowHours: data.quotaWindowHours,
            quotaWindows: data.quotaWindows,
            note: data.note,
          },
          actorUserId,
        );

        results.push({
          userId: target.id,
          username: target.username,
          userPassId: created.id,
          result: "created",
        });
      } catch (error) {
        results.push({
          userId: target.id,
          username: target.username,
          result: "failed",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }

    const createdCount = results.filter((item) => item.result === "created").length;
    const extendedCount = results.filter((item) => item.result === "extended").length;
    const failedCount = results.filter((item) => item.result === "failed").length;

    await this.businessLogService.logOperation({
      operationType: OperationType.MONTHLY_PASS_ASSIGNMENT_CREATE,
      operationCategory: OperationCategory.BILLING,
      actorUserId,
      targetResourceType: "USER_MONTHLY_PASS_BATCH",
      description: `批量分配月卡完成，共 ${results.length} 个目标，成功 ${createdCount + extendedCount}，失败 ${failedCount}`,
      changes: {
        templateId: data.templateId,
        assignmentMode,
        totalTargets: results.length,
        createdCount,
        extendedCount,
        failedCount,
      },
      success: failedCount === 0,
      ...buildBusinessLogRequestContext(request),
    });

    return {
      totalTargets: results.length,
      successCount: createdCount + extendedCount,
      createdCount,
      extendedCount,
      failedCount,
      records: results,
    };
  }

  async listUsages(
    page?: number,
    pageSize?: number,
    userId?: string,
    templateId?: string,
    model?: string,
    startTime?: string,
    endTime?: string,
  ): Promise<MonthlyPassUsageListResponse> {
    const paging = normalizePagination(page, pageSize);
    const parsedStartTime = parseDateStringOrThrow("startTime", startTime);
    const parsedEndTime = parseDateStringOrThrow("endTime", endTime);

    if (parsedStartTime && parsedEndTime && parsedEndTime.getTime() < parsedStartTime.getTime())
      throw new BadRequestError("endTime must be later than startTime");

    const where: Prisma.MonthlyPassUsageWhereInput = { status: MANAGED_STATUS.ENABLED };
    if (userId) where.userId = userId;
    if (model) where.model = model;
    if (templateId) where.userMonthlyPass = { templateId };

    if (parsedStartTime || parsedEndTime) {
      where.createTime = {};
      if (parsedStartTime) where.createTime.gte = parsedStartTime;
      if (parsedEndTime) where.createTime.lte = parsedEndTime;
    }

    const result = await this.monthlyPassRepository.listUsageRecords(where, paging.page, paging.pageSize);

    return {
      total: result.total,
      records: result.records.map((item) => this.toUsageDto(item)),
      page: paging.page,
      pageSize: paging.pageSize,
    };
  }

  async hasActiveCoverage(
    userId: string,
    modelName: string,
    channelId: string,
    at: Date = new Date(),
  ): Promise<boolean> {
    const candidates = await this.monthlyPassRepository.findActivePassCandidates(userId, at);
    const channelMatchCache = new Map<string, boolean>();
    const matchedCandidates = (
      await Promise.all(
        candidates.map(async (item) => {
          if (!isMonthlyPassModelMatched(item.template, modelName)) return null;

          const allowedChannelIds = parseAllowedChannels(item.template.allowedChannels);
          if (!allowedChannelIds || allowedChannelIds.length === 0) return item;

          const cacheKey = `${allowedChannelIds.slice().sort().join(",")}:${channelId}`;
          let isChannelMatched = channelMatchCache.get(cacheKey);
          if (isChannelMatched === undefined) {
            const activeLeaves = await this.relayPoolResolver.resolveActiveLeaves(
              allowedChannelIds.map((id) => ({ id })),
            );
            isChannelMatched = activeLeaves.some((channel) => channel.id === channelId);
            channelMatchCache.set(cacheKey, isChannelMatched);
          }

          return isChannelMatched ? item : null;
        }),
      )
    ).filter((item): item is (typeof candidates)[number] => item !== null);
    if (matchedCandidates.length === 0) return false;

    const limitedCandidates = matchedCandidates.filter(
      (item) => this.getUserPassQuotaWindows(item as UserMonthlyPassWithTemplate).length > 0,
    );
    if (limitedCandidates.length === 0) return true;

    const usageSummaryByQuotaWindowKey = await this.getQuotaWindowUsageSummaryMap(
      limitedCandidates as UserMonthlyPassWithTemplate[],
      at,
    );

    return matchedCandidates.some((item) => {
      const quotaWindows = this.getUserPassQuotaWindows(item as UserMonthlyPassWithTemplate);
      if (quotaWindows.length === 0) return true;

      return quotaWindows.every((quotaWindow) => {
        const windowConsumed = getWindowConsumed(
          usageSummaryByQuotaWindowKey[
            getQuotaWindowUsageKey(item.id, quotaWindow.quotaUnit, quotaWindow.quotaWindowHours)
          ],
          quotaWindow.quotaUnit,
        );
        return round4(quotaWindow.quotaLimit - windowConsumed) > 0;
      });
    });
  }
}

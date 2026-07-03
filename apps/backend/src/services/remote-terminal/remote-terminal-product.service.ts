import { randomBytes } from "node:crypto";
import type {
  AssignRemoteTerminalEntitlementRequest,
  RemoteTerminalBillingUnit,
  ClaimRemoteTerminalProductTemplateRequest,
  CreateRemoteTerminalProductTemplateRequest,
  RemoteTerminalBoundDeviceDto,
  RemoteTerminalBoundDeviceListResponse,
  RemoteTerminalFilterOptionsDto,
  RemoteTerminalInstallTokenDto,
  RemoteTerminalProductTemplateDto,
  RemoteTerminalProductTemplateListResponse,
  RemoteTerminalRegistrationTokenDto,
  RemoteTerminalUnbindReminderDto,
  RemoteTerminalUserEntitlementDto,
  RemoteTerminalUserEntitlementListResponse,
  RotateRemoteTerminalRegistrationTokenRequest,
  UpdateRemoteTerminalEntitlementRequest,
  UpdateRemoteTerminalProductTemplateRequest,
} from "@/api/dto/remote-terminal/remote-terminal.dto";
import { issueInstallToken as buildInstallToken } from "@/modules/remote-terminal/install-token";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { MANAGED_STATUS } from "@/constant/status";
import type { RemoteTerminalHostSnapshot } from "@/modules/remote-terminal/protocol";
import type {
  RemoteTerminalDeviceBindingWithRelations,
  RemoteTerminalEntitlementWithRelations,
  RemoteTerminalProductStore,
} from "@/store/remote-terminal-product/remote-terminal-product.store";
import { RemoteTerminalProductRepository } from "@/store/remote-terminal-product/remote-terminal-product.repository";
import { UserRepository } from "@/store/users/user.repository";
import type { TypedRequest } from "@/types/express";
import BusinessLogService from "@/services/system/businesslog.service";
import { ConfigService } from "@/services/system/config.service";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/util/errors";
import type { Prisma } from "@prisma/client";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_DEVICE_LIMIT = 999999;
const MAX_TERMINAL_LIMIT = 999999;
const MAX_DURATION_DAYS = 3650;
const DEFAULT_CURRENCY = "曲";
const DEFAULT_SELF_CLAIM_NOTE = "self-claimed";
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const BILLING_UNIT_DAYS: Record<RemoteTerminalBillingUnit, number> = {
  day: 1,
  week: 7,
  month: 30,
};
const DEFAULT_STATUS_OPTIONS = [
  { value: MANAGED_STATUS.ENABLED, label: "enabled" },
  { value: MANAGED_STATUS.DISABLED, label: "disabled" },
];
const DEFAULT_PUBLISH_STATUS_OPTIONS = [
  { value: "draft", label: "draft" },
  { value: "published", label: "published" },
];

const normalizePagination = (page?: number, pageSize?: number): { page: number; pageSize: number } => {
  const normalizedPage = page && page > 0 ? page : 1;
  const normalizedPageSize = pageSize && pageSize > 0 ? Math.min(pageSize, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  return { page: normalizedPage, pageSize: normalizedPageSize };
};

const hasDecimalPrecision = (value: number, scale: number): boolean => {
  const factor = 10 ** scale;
  const scaled = value * factor;
  return Math.abs(Math.round(scaled) - scaled) < 1e-8;
};

const parseOptionalDate = (fieldName: string, value?: string | null): Date | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestError(`${fieldName} must be a valid date string`);
  return parsed;
};

const parseRequiredDate = (fieldName: string, value: string): Date => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestError(`${fieldName} must be a valid date string`);
  return parsed;
};

const maskToken = (token: string): string => {
  if (token.length <= 10) return token;
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
};

const normalizeText = (value?: string | null): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getSnapshotAvailableShells = (snapshot: unknown): RemoteTerminalBoundDeviceDto["availableShells"] => {
  const hostSnapshot = snapshot as RemoteTerminalHostSnapshot | null;
  return Array.isArray(hostSnapshot?.diagnostics?.availableShells) ? hostSnapshot.diagnostics.availableShells : [];
};

export class RemoteTerminalProductService {
  private static instance: RemoteTerminalProductService;

  private constructor(
    private readonly productRepository: RemoteTerminalProductStore = RemoteTerminalProductRepository.getInstance(),
    private readonly userRepository: UserRepository = UserRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly configService: ConfigService = ConfigService.getInstance(),
  ) {}

  public static getInstance(): RemoteTerminalProductService {
    if (!RemoteTerminalProductService.instance)
      RemoteTerminalProductService.instance = new RemoteTerminalProductService();

    return RemoteTerminalProductService.instance;
  }

  private async assertDeviceUnbindAllowed(existing: RemoteTerminalDeviceBindingWithRelations): Promise<void> {
    const config = await this.configService.getRemoteTerminalUnbindConfig();
    if (config.maxCount <= 0) throw new BadRequestError("Device unbinding is currently disabled.");

    const windowStart = new Date(Date.now() - config.windowHours * 60 * 60 * 1000);
    const effectiveStart =
      existing.entitlement?.unbindResetAt && existing.entitlement.unbindResetAt > windowStart
        ? existing.entitlement.unbindResetAt
        : windowStart;
    const revokedCount = await this.productRepository.countRevokedDeviceBindingsForEntitlementInWindow(
      existing.entitlementId,
      effectiveStart,
    );

    if (revokedCount >= config.maxCount)
      throw new BadRequestError(
        `Device unbind limit reached. Up to ${config.maxCount} unbinds are allowed within ${config.windowHours} hours.`,
      );
  }

  public async getCurrentUserDeviceUnbindReminder(
    userId: string,
    deviceBindingId: string,
  ): Promise<RemoteTerminalUnbindReminderDto> {
    const existing = await this.productRepository.findDeviceBindingById(deviceBindingId);
    if (!existing || existing.status === MANAGED_STATUS.DELETED) throw new NotFoundError("Device binding not found");
    if (existing.userId !== userId) throw new ForbiddenError("You can only view your own device unbind policy");

    const config = await this.configService.getRemoteTerminalUnbindConfig();
    const windowStartAt = new Date(Date.now() - config.windowHours * 60 * 60 * 1000);
    const effectiveStart =
      existing.entitlement?.unbindResetAt && existing.entitlement.unbindResetAt > windowStartAt
        ? existing.entitlement.unbindResetAt
        : windowStartAt;
    const revokedCount = await this.productRepository.countRevokedDeviceBindingsForEntitlementInWindow(
      existing.entitlementId,
      effectiveStart,
    );

    return {
      maxCount: config.maxCount,
      windowHours: config.windowHours,
      rebindCooldownMinutes: config.rebindCooldownMinutes,
      revokedCount,
      remainingCount: Math.max(0, config.maxCount - revokedCount),
      windowStartAt: effectiveStart,
    };
  }

  private validatePrice(value?: number): number | null | undefined {
    if (value === undefined) return undefined;
    if (!Number.isFinite(value) || value < 0) throw new BadRequestError("price must be greater than or equal to 0");
    if (!hasDecimalPrecision(value, 4)) throw new BadRequestError("price must have at most 4 decimal places");
    return Number(value.toFixed(4));
  }

  private validateDailyPrice(fieldName: string, value?: number | null): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (!Number.isFinite(value) || value < 0)
      throw new BadRequestError(`${fieldName} must be greater than or equal to 0`);
    if (!hasDecimalPrecision(value, 4)) throw new BadRequestError(`${fieldName} must have at most 4 decimal places`);
    return Number(value.toFixed(4));
  }

  private validateBillingUnit(value?: string | null): RemoteTerminalBillingUnit {
    if (!value) return "day";
    if (value === "day" || value === "week" || value === "month") return value;
    throw new BadRequestError("billingUnit must be one of: day, week, month");
  }

  private getBillingUnitDays(value: RemoteTerminalBillingUnit): number {
    return BILLING_UNIT_DAYS[value];
  }

  private validateMinimumPurchaseUnits(value?: number): number | undefined {
    const normalized = this.validatePositiveInteger("minimumPurchaseUnits", value);
    if (normalized !== undefined && normalized > MAX_DURATION_DAYS)
      throw new BadRequestError(`minimumPurchaseUnits must be less than or equal to ${MAX_DURATION_DAYS}`);
    return normalized;
  }

  private validateMaximumPurchaseUnits(value?: number | null): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const normalized = this.validatePositiveInteger("maximumPurchaseUnits", value);
    if (normalized !== undefined && normalized > MAX_DURATION_DAYS)
      throw new BadRequestError(`maximumPurchaseUnits must be less than or equal to ${MAX_DURATION_DAYS}`);
    return normalized;
  }

  private validatePurchaseUnits(value?: number): number | undefined {
    const normalized = this.validatePositiveInteger("purchaseUnits", value);
    if (normalized !== undefined && normalized > MAX_DURATION_DAYS)
      throw new BadRequestError(`purchaseUnits must be less than or equal to ${MAX_DURATION_DAYS}`);
    return normalized;
  }

  private validateUnitPrice(fieldName: string, value?: number | null): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (!Number.isFinite(value) || value < 0)
      throw new BadRequestError(`${fieldName} must be greater than or equal to 0`);
    if (!hasDecimalPrecision(value, 4)) throw new BadRequestError(`${fieldName} must have at most 4 decimal places`);
    return Number(value.toFixed(4));
  }

  private deriveDailyPriceFromUnitPrice(
    unitPrice: number | null | undefined,
    billingUnit: RemoteTerminalBillingUnit,
  ): number | null | undefined {
    if (unitPrice === undefined) return undefined;
    if (unitPrice === null) return null;
    return this.validateDailyPrice("dailyPrice", unitPrice / this.getBillingUnitDays(billingUnit)) ?? null;
  }

  private restoreUnitPriceFromStoredValues(
    billingUnit: RemoteTerminalBillingUnit,
    unitPrice: Prisma.Decimal | number | string | null | undefined,
    dailyPrice: Prisma.Decimal | number | string | null | undefined,
  ): number | null {
    if (unitPrice != null) return Number(unitPrice);
    if (dailyPrice == null) return null;
    return Number((Number(dailyPrice) * this.getBillingUnitDays(billingUnit)).toFixed(4));
  }

  private calculatePurchaseUnitsFromDurationDays(durationDays: number, billingUnit: RemoteTerminalBillingUnit): number {
    return Math.max(1, Math.ceil(durationDays / this.getBillingUnitDays(billingUnit)));
  }

  private calculateDurationDaysFromPurchaseUnits(
    purchaseUnits: number,
    billingUnit: RemoteTerminalBillingUnit,
  ): number {
    return purchaseUnits * this.getBillingUnitDays(billingUnit);
  }

  private validateOptionalPositiveIntegerOrNull(fieldName: string, value?: number | null): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (!Number.isInteger(value) || value <= 0) throw new BadRequestError(`${fieldName} must be a positive integer`);
    return value;
  }

  private validatePurchaseLimitConfig(
    purchaseLimitPerUser?: number | null,
    purchaseLimitWindowDays?: number | null,
  ): { purchaseLimitPerUser: number | null | undefined; purchaseLimitWindowDays: number | null | undefined } {
    const normalizedLimit = this.validateOptionalPositiveIntegerOrNull("purchaseLimitPerUser", purchaseLimitPerUser);
    const normalizedWindow = this.validateOptionalPositiveIntegerOrNull(
      "purchaseLimitWindowDays",
      purchaseLimitWindowDays,
    );

    const hasLimit = normalizedLimit !== undefined && normalizedLimit !== null;
    const hasWindow = normalizedWindow !== undefined && normalizedWindow !== null;
    if (hasLimit !== hasWindow)
      throw new BadRequestError("purchaseLimitPerUser and purchaseLimitWindowDays must be set together");

    return {
      purchaseLimitPerUser: normalizedLimit,
      purchaseLimitWindowDays: normalizedWindow,
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
    if (!template.purchaseLimitPerUser || !template.purchaseLimitWindowDays) return;

    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - template.purchaseLimitWindowDays);

    const currentCount = await this.productRepository.countUserEntitlementsInWindow(userId, template.id, windowStart);
    if (currentCount >= template.purchaseLimitPerUser)
      throw new BadRequestError(
        `purchase limit exceeded: at most ${template.purchaseLimitPerUser} claim(s) per ${template.purchaseLimitWindowDays} day(s)`,
      );
  }

  private buildTemplateEntitlementRange(durationDays: number): { startAt: Date; endAt: Date } {
    const startAt = new Date();
    const endAt = new Date(startAt.getTime());
    endAt.setDate(endAt.getDate() + durationDays);
    return { startAt, endAt };
  }

  private buildMergedEntitlementRange(
    existingStartAt: Date,
    existingEndAt: Date,
    durationDays: number,
  ): { startAt: Date; endAt: Date } {
    const now = new Date();
    const hasRemainingValidity = existingEndAt.getTime() > now.getTime();
    const startAt = hasRemainingValidity ? existingStartAt : now;
    const renewalBase = hasRemainingValidity ? existingEndAt : now;
    const endAt = new Date(renewalBase.getTime());
    endAt.setDate(endAt.getDate() + durationDays);
    return { startAt, endAt };
  }

  private calculateDurationDaysFromRange(startAt: Date, endAt: Date): number {
    const diff = endAt.getTime() - startAt.getTime();
    return Math.max(1, Math.ceil(diff / DAY_IN_MS));
  }

  private validatePositiveInteger(fieldName: string, value?: number): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isInteger(value) || value <= 0) throw new BadRequestError(`${fieldName} must be a positive integer`);
    return value;
  }

  private validateNonNegativeInteger(fieldName: string, value?: number): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isInteger(value) || value < 0) throw new BadRequestError(`${fieldName} must be a non-negative integer`);
    return value;
  }

  private validateDurationDays(value?: number): number | undefined {
    const normalized = this.validatePositiveInteger("durationDays", value);
    if (normalized !== undefined && normalized > MAX_DURATION_DAYS)
      throw new BadRequestError(`durationDays must be less than or equal to ${MAX_DURATION_DAYS}`);
    return normalized;
  }

  private validateDeviceLimit(value?: number): number | undefined {
    const normalized = this.validateNonNegativeInteger("deviceLimit", value);
    if (normalized !== undefined && normalized > MAX_DEVICE_LIMIT)
      throw new BadRequestError(`deviceLimit must be less than or equal to ${MAX_DEVICE_LIMIT}`);
    return normalized;
  }

  private validateTerminalLimit(value?: number): number | undefined {
    const normalized = this.validateNonNegativeInteger("terminalLimit", value);
    if (normalized !== undefined && normalized > MAX_TERMINAL_LIMIT)
      throw new BadRequestError(`terminalLimit must be less than or equal to ${MAX_TERMINAL_LIMIT}`);
    return normalized;
  }

  private ensureAtLeastOneQuota(deviceLimit?: number, terminalLimit?: number): void {
    if ((deviceLimit ?? 0) <= 0 && (terminalLimit ?? 0) <= 0)
      throw new BadRequestError("deviceLimit and terminalLimit cannot both be 0");
  }

  private ensureAtLeastOneOfferedUnit(devicePrice?: number | null, terminalPrice?: number | null): void {
    if (devicePrice == null && terminalPrice == null)
      throw new BadRequestError("devicePrice and terminalPrice cannot both be empty");
  }

  private ensureUnitSupported(fieldName: "deviceCount" | "terminalCount", count: number, price?: number | null): void {
    if (count > 0 && price == null) throw new BadRequestError(`${fieldName} is unavailable for this template`);
  }

  private calculatePurchaseAmount(params: {
    durationDays: number;
    billingUnit: RemoteTerminalBillingUnit;
    deviceCount: number;
    terminalCount: number;
    devicePrice?: number | null;
    terminalPrice?: number | null;
  }): number {
    const purchaseFactor = params.durationDays / this.getBillingUnitDays(params.billingUnit);
    const devicePart = params.deviceCount * Number(params.devicePrice ?? 0);
    const terminalPart = params.terminalCount * Number(params.terminalPrice ?? 0);
    return Number((purchaseFactor * (devicePart + terminalPart)).toFixed(4));
  }

  private ensureMergedQuotaTargets(
    existing: Pick<RemoteTerminalEntitlementWithRelations, "deviceLimit" | "terminalLimit">,
    deviceCount: number,
    terminalCount: number,
  ): void {
    if (deviceCount < existing.deviceLimit)
      throw new BadRequestError("deviceCount cannot be lower than the current entitlement device limit");
    if (terminalCount < existing.terminalLimit)
      throw new BadRequestError("terminalCount cannot be lower than the current entitlement terminal limit");
  }

  private calculateMergedUpgradeDurationDays(
    existing: Pick<RemoteTerminalEntitlementWithRelations, "startAt" | "endAt">,
    durationDays: number,
  ): number {
    const { endAt } = this.buildMergedEntitlementRange(existing.startAt, existing.endAt, durationDays);
    const now = new Date();

    if (existing.endAt.getTime() <= now.getTime()) return durationDays;

    const effectiveStartAt = existing.startAt.getTime() > now.getTime() ? existing.startAt : now;
    return this.calculateDurationDaysFromRange(effectiveStartAt, endAt);
  }

  private calculateMergedPurchaseAmount(params: {
    existing: Pick<RemoteTerminalEntitlementWithRelations, "startAt" | "endAt" | "deviceLimit" | "terminalLimit">;
    durationDays: number;
    billingUnit: RemoteTerminalBillingUnit;
    deviceCount: number;
    terminalCount: number;
    devicePrice?: number | null;
    terminalPrice?: number | null;
  }): number {
    const renewalAmount = this.calculatePurchaseAmount({
      durationDays: params.durationDays,
      billingUnit: params.billingUnit,
      deviceCount: params.existing.deviceLimit,
      terminalCount: params.existing.terminalLimit,
      devicePrice: params.devicePrice,
      terminalPrice: params.terminalPrice,
    });

    const additionalDeviceCount = Math.max(0, params.deviceCount - params.existing.deviceLimit);
    const additionalTerminalCount = Math.max(0, params.terminalCount - params.existing.terminalLimit);

    if (additionalDeviceCount <= 0 && additionalTerminalCount <= 0) return renewalAmount;

    const upgradeDurationDays = this.calculateMergedUpgradeDurationDays(params.existing, params.durationDays);
    const upgradeAmount = this.calculatePurchaseAmount({
      durationDays: upgradeDurationDays,
      billingUnit: params.billingUnit,
      deviceCount: additionalDeviceCount,
      terminalCount: additionalTerminalCount,
      devicePrice: params.devicePrice,
      terminalPrice: params.terminalPrice,
    });

    return Number((renewalAmount + upgradeAmount).toFixed(4));
  }

  private canIssueRegistrationToken(deviceLimit: number): boolean {
    return deviceLimit > 0;
  }

  private ensureDateRange(startAt: Date, endAt: Date): void {
    if (endAt.getTime() <= startAt.getTime()) throw new BadRequestError("endAt must be greater than startAt");
  }

  private toTemplateDto(record: {
    id: string;
    name: string;
    description: string | null;
    publishStatus: string;
    publishedAt: Date | null;
    billingUnit: string;
    minimumPurchaseUnits: number;
    maximumPurchaseUnits: number | null;
    devicePrice: Prisma.Decimal | number | string | null;
    terminalPrice: Prisma.Decimal | number | string | null;
    deviceDailyPrice: Prisma.Decimal | number | string | null;
    terminalDailyPrice: Prisma.Decimal | number | string | null;
    currency: string;
    purchaseLimitPerUser: number | null;
    purchaseLimitWindowDays: number | null;
    minimumDeviceCount: number | null;
    minimumTerminalCount: number | null;
    maxDeviceCount: number | null;
    maxTerminalCount: number | null;
    status: number;
    createTime: Date;
    updateTime: Date;
  }): RemoteTerminalProductTemplateDto {
    const billingUnit = this.validateBillingUnit(record.billingUnit);
    return {
      id: record.id,
      name: record.name,
      description: record.description ?? undefined,
      publishStatus: record.publishStatus === "published" ? "published" : "draft",
      publishedAt: record.publishedAt ?? undefined,
      billingUnit,
      minimumPurchaseUnits: record.minimumPurchaseUnits,
      maximumPurchaseUnits: record.maximumPurchaseUnits ?? undefined,
      devicePrice:
        this.restoreUnitPriceFromStoredValues(billingUnit, record.devicePrice, record.deviceDailyPrice) ?? undefined,
      terminalPrice:
        this.restoreUnitPriceFromStoredValues(billingUnit, record.terminalPrice, record.terminalDailyPrice) ??
        undefined,
      deviceDailyPrice: record.deviceDailyPrice != null ? Number(record.deviceDailyPrice) : undefined,
      terminalDailyPrice: record.terminalDailyPrice != null ? Number(record.terminalDailyPrice) : undefined,
      currency: record.currency,
      purchaseLimitPerUser: record.purchaseLimitPerUser ?? undefined,
      purchaseLimitWindowDays: record.purchaseLimitWindowDays ?? undefined,
      minimumDeviceCount: record.minimumDeviceCount ?? undefined,
      minimumTerminalCount: record.minimumTerminalCount ?? undefined,
      maxDeviceCount: record.maxDeviceCount ?? undefined,
      maxTerminalCount: record.maxTerminalCount ?? undefined,
      status: record.status,
      createTime: record.createTime,
      updateTime: record.updateTime,
    };
  }

  private toRegistrationTokenDto(record: {
    id: string;
    entitlementId: string;
    token: string;
    label: string | null;
    expiresAt: Date | null;
    lastUsedAt: Date | null;
    status: number;
    createTime: Date;
    updateTime: Date;
  }): RemoteTerminalRegistrationTokenDto {
    return {
      id: record.id,
      entitlementId: record.entitlementId,
      token: record.token,
      maskedToken: maskToken(record.token),
      label: record.label ?? undefined,
      expiresAt: record.expiresAt ?? undefined,
      lastUsedAt: record.lastUsedAt ?? undefined,
      status: record.status,
      createTime: record.createTime,
      updateTime: record.updateTime,
    };
  }

  private async getUsernamesByIds(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(ids.filter((item): item is string => Boolean(item)))];
    if (uniqueIds.length === 0) return new Map();
    const records = await this.userRepository.findUsernamesByIds(uniqueIds);
    return new Map(records.map((item) => [item.id, item.username]));
  }

  private toEntitlementDto(
    record: RemoteTerminalEntitlementWithRelations,
    usernamesById: Map<string, string>,
  ): RemoteTerminalUserEntitlementDto {
    const now = Date.now();
    const isActive =
      record.status === MANAGED_STATUS.ENABLED && record.startAt.getTime() <= now && record.endAt.getTime() >= now;
    return {
      id: record.id,
      userId: record.userId,
      username: record.user.username,
      templateId: record.templateId ?? undefined,
      templateName: record.template?.name,
      name: record.name,
      description: record.description ?? undefined,
      startAt: record.startAt,
      endAt: record.endAt,
      billingUnit: this.validateBillingUnit(record.billingUnit),
      purchaseUnits: record.purchaseUnits,
      durationDays: record.durationDays,
      deviceLimit: record.deviceLimit,
      terminalLimit: record.terminalLimit,
      purchasedDeviceCount: record.purchasedDeviceCount,
      purchasedTerminalCount: record.purchasedTerminalCount,
      devicePrice:
        this.restoreUnitPriceFromStoredValues(
          this.validateBillingUnit(record.billingUnit),
          record.devicePrice,
          record.deviceDailyPrice,
        ) ?? undefined,
      terminalPrice:
        this.restoreUnitPriceFromStoredValues(
          this.validateBillingUnit(record.billingUnit),
          record.terminalPrice,
          record.terminalDailyPrice,
        ) ?? undefined,
      deviceDailyPrice: record.deviceDailyPrice != null ? Number(record.deviceDailyPrice) : undefined,
      terminalDailyPrice: record.terminalDailyPrice != null ? Number(record.terminalDailyPrice) : undefined,
      purchaseAmount: record.purchaseAmount != null ? Number(record.purchaseAmount) : undefined,
      currency: record.currency,
      assignedBy: record.assignedBy ?? undefined,
      assignedByUsername: record.assignedBy ? usernamesById.get(record.assignedBy) : undefined,
      note: record.note ?? undefined,
      status: record.status,
      createTime: record.createTime,
      updateTime: record.updateTime,
      isActive,
      isExpired: record.endAt.getTime() < now,
      registeredDeviceCount: record.devices.length,
      registrationToken:
        this.canIssueRegistrationToken(record.deviceLimit) && record.registrationToken
          ? this.toRegistrationTokenDto(record.registrationToken)
          : undefined,
      maxDeviceCount: record.maxDeviceCount ?? undefined,
      maxTerminalCount: record.maxTerminalCount ?? undefined,
    };
  }

  private toDeviceDto(record: RemoteTerminalDeviceBindingWithRelations): RemoteTerminalBoundDeviceDto {
    return {
      id: record.id,
      entitlementId: record.entitlementId,
      entitlementName: record.entitlement.name,
      userId: record.userId,
      username: record.user.username,
      registrationTokenId: record.registrationTokenId ?? undefined,
      deviceId: record.deviceId,
      fingerprint: record.fingerprint,
      hostname: record.hostname,
      platform: record.platform as RemoteTerminalBoundDeviceDto["platform"],
      arch: record.arch,
      availableShells: getSnapshotAvailableShells(record.snapshot),
      online: record.online,
      registeredAt: record.registeredAt,
      lastSeenAt: record.lastSeenAt,
      lastOnlineAt: record.lastOnlineAt ?? undefined,
      status: record.status,
      createTime: record.createTime,
      updateTime: record.updateTime,
    };
  }

  private async ensureUserExists(userId: string): Promise<void> {
    const user = await this.userRepository.findActiveById(userId);
    if (!user) throw new NotFoundError("User not found");
  }

  private buildRandomToken(): string {
    return `rtm_${randomBytes(24).toString("hex")}`;
  }

  private async ensureRegistrationTokenForEntitlement(
    entitlementId: string,
  ): Promise<RemoteTerminalRegistrationTokenDto> {
    const existing = await this.productRepository.findTokenByEntitlementId(entitlementId);
    if (existing) return this.toRegistrationTokenDto(existing);

    const created = await this.productRepository.upsertEntitlementToken(entitlementId, {
      entitlementId,
      token: this.buildRandomToken(),
      label: "default",
      status: MANAGED_STATUS.ENABLED,
    });
    return this.toRegistrationTokenDto(created);
  }

  public async getRuntimeTotalTerminalLimit(userId: string, at: Date = new Date()): Promise<number> {
    return this.productRepository.sumActiveTerminalLimitForUser(userId, at);
  }

  public async getRuntimeTotalDeviceLimit(userId: string, at: Date = new Date()): Promise<number> {
    return this.productRepository.sumActiveDeviceLimitForUser(userId, at);
  }

  public async getFilterOptions(): Promise<RemoteTerminalFilterOptionsDto> {
    const templates = await this.productRepository.listTemplateFilterOptions();
    return {
      templateStatusOptions: DEFAULT_STATUS_OPTIONS,
      assignmentStatusOptions: DEFAULT_STATUS_OPTIONS,
      deviceStatusOptions: DEFAULT_STATUS_OPTIONS,
      publishStatusOptions: DEFAULT_PUBLISH_STATUS_OPTIONS,
      templates,
    };
  }

  public async listPublishedTemplates(): Promise<RemoteTerminalProductTemplateDto[]> {
    const records = await this.productRepository.listPublishedTemplates();
    return records.map((item) => this.toTemplateDto(item));
  }

  public async listTemplates(
    page?: number,
    pageSize?: number,
    status?: number,
    keyword?: string,
  ): Promise<RemoteTerminalProductTemplateListResponse> {
    const pagination = normalizePagination(page, pageSize);
    const trimmedKeyword = keyword?.trim();
    const where: Prisma.RemoteTerminalProductTemplateWhereInput = {
      status: status !== undefined ? status : { gte: MANAGED_STATUS.DISABLED },
      ...(trimmedKeyword
        ? {
            OR: [{ name: { contains: trimmedKeyword } }, { description: { contains: trimmedKeyword } }],
          }
        : {}),
    };
    const result = await this.productRepository.listTemplates(where, pagination.page, pagination.pageSize);
    return {
      total: result.total,
      records: result.records.map((item) => this.toTemplateDto(item)),
      page: pagination.page,
      pageSize: pagination.pageSize,
    };
  }

  public async createTemplate(
    body: CreateRemoteTerminalProductTemplateRequest,
    actorUserId: string,
    request?: TypedRequest,
  ): Promise<RemoteTerminalProductTemplateDto> {
    const name = body.name.trim();
    const existing = await this.productRepository.findTemplateByName(name);
    if (existing) throw new BadRequestError("Template name already exists");

    const billingUnit = this.validateBillingUnit(body.billingUnit);
    const minimumPurchaseUnits = this.validateMinimumPurchaseUnits(body.minimumPurchaseUnits) ?? 1;
    const maximumPurchaseUnits = this.validateMaximumPurchaseUnits(body.maximumPurchaseUnits);
    const devicePrice = this.validateUnitPrice("devicePrice", body.devicePrice);
    const terminalPrice = this.validateUnitPrice("terminalPrice", body.terminalPrice);
    const deviceDailyPrice = this.deriveDailyPriceFromUnitPrice(devicePrice, billingUnit);
    const terminalDailyPrice = this.deriveDailyPriceFromUnitPrice(terminalPrice, billingUnit);
    const purchaseLimitConfig = this.validatePurchaseLimitConfig(
      body.purchaseLimitPerUser,
      body.purchaseLimitWindowDays,
    );

    if (maximumPurchaseUnits != null && minimumPurchaseUnits > maximumPurchaseUnits)
      throw new BadRequestError("minimumPurchaseUnits cannot be greater than maximumPurchaseUnits");

    this.ensureAtLeastOneOfferedUnit(devicePrice, terminalPrice);

    const created = await this.productRepository.createTemplate({
      name,
      description: normalizeText(body.description) ?? null,
      billingUnit,
      minimumPurchaseUnits,
      maximumPurchaseUnits: maximumPurchaseUnits ?? null,
      devicePrice: devicePrice ?? null,
      terminalPrice: terminalPrice ?? null,
      deviceDailyPrice: deviceDailyPrice ?? null,
      terminalDailyPrice: terminalDailyPrice ?? null,
      currency: body.currency?.trim() || DEFAULT_CURRENCY,
      purchaseLimitPerUser: purchaseLimitConfig.purchaseLimitPerUser ?? null,
      purchaseLimitWindowDays: purchaseLimitConfig.purchaseLimitWindowDays ?? null,
      minimumDeviceCount: body.minimumDeviceCount ?? null,
      minimumTerminalCount: body.minimumTerminalCount ?? null,
      maxDeviceCount: body.maxDeviceCount ?? null,
      maxTerminalCount: body.maxTerminalCount ?? null,
      publishStatus: "draft",
      status: MANAGED_STATUS.ENABLED,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.REMOTE_TERMINAL_PRODUCT_TEMPLATE_CREATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceType: "REMOTE_TERMINAL_PRODUCT_TEMPLATE",
      targetResourceId: created.id,
      description: `Created remote terminal product template '${created.name}'`,
      changes: body,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toTemplateDto(created);
  }

  public async updateTemplate(
    id: string,
    body: UpdateRemoteTerminalProductTemplateRequest,
    actorUserId: string,
    request?: TypedRequest,
  ): Promise<RemoteTerminalProductTemplateDto> {
    const existing = await this.productRepository.findTemplateById(id);
    if (!existing || existing.status === MANAGED_STATUS.DELETED) throw new NotFoundError("Template not found");

    const nextName = body.name?.trim();
    if (nextName && nextName !== existing.name) {
      const duplicate = await this.productRepository.findTemplateByName(nextName);
      if (duplicate && duplicate.id !== id) throw new BadRequestError("Template name already exists");
    }

    const data: Prisma.RemoteTerminalProductTemplateUncheckedUpdateInput = {};
    if (nextName !== undefined) data.name = nextName;
    if (body.description !== undefined) data.description = normalizeText(body.description) ?? null;

    const nextBillingUnit =
      body.billingUnit !== undefined
        ? this.validateBillingUnit(body.billingUnit)
        : this.validateBillingUnit(existing.billingUnit);
    const existingDevicePrice = this.restoreUnitPriceFromStoredValues(
      this.validateBillingUnit(existing.billingUnit),
      (existing as { devicePrice?: Prisma.Decimal | number | string | null }).devicePrice,
      existing.deviceDailyPrice,
    );
    const existingTerminalPrice = this.restoreUnitPriceFromStoredValues(
      this.validateBillingUnit(existing.billingUnit),
      (existing as { terminalPrice?: Prisma.Decimal | number | string | null }).terminalPrice,
      existing.terminalDailyPrice,
    );
    const nextDevicePrice =
      body.devicePrice !== undefined
        ? body.devicePrice === null
          ? null
          : this.validateUnitPrice("devicePrice", body.devicePrice)
        : existingDevicePrice;
    const nextTerminalPrice =
      body.terminalPrice !== undefined
        ? body.terminalPrice === null
          ? null
          : this.validateUnitPrice("terminalPrice", body.terminalPrice)
        : existingTerminalPrice;

    if (body.billingUnit !== undefined) data.billingUnit = nextBillingUnit;
    if (body.minimumPurchaseUnits !== undefined)
      data.minimumPurchaseUnits = this.validateMinimumPurchaseUnits(body.minimumPurchaseUnits);
    if (body.maximumPurchaseUnits !== undefined)
      data.maximumPurchaseUnits = this.validateMaximumPurchaseUnits(body.maximumPurchaseUnits);
    if (body.devicePrice !== undefined) data.devicePrice = nextDevicePrice;
    if (body.terminalPrice !== undefined) data.terminalPrice = nextTerminalPrice;
    if (body.billingUnit !== undefined || body.devicePrice !== undefined)
      data.deviceDailyPrice = this.deriveDailyPriceFromUnitPrice(nextDevicePrice, nextBillingUnit) ?? null;
    if (body.billingUnit !== undefined || body.terminalPrice !== undefined)
      data.terminalDailyPrice = this.deriveDailyPriceFromUnitPrice(nextTerminalPrice, nextBillingUnit) ?? null;
    if (body.currency !== undefined) data.currency = body.currency.trim() || DEFAULT_CURRENCY;
    if (body.purchaseLimitPerUser !== undefined || body.purchaseLimitWindowDays !== undefined) {
      const nextLimit =
        body.purchaseLimitPerUser !== undefined ? body.purchaseLimitPerUser : existing.purchaseLimitPerUser;
      const nextWindow =
        body.purchaseLimitWindowDays !== undefined ? body.purchaseLimitWindowDays : existing.purchaseLimitWindowDays;
      const purchaseLimitConfig = this.validatePurchaseLimitConfig(nextLimit, nextWindow);
      data.purchaseLimitPerUser = purchaseLimitConfig.purchaseLimitPerUser ?? null;
      data.purchaseLimitWindowDays = purchaseLimitConfig.purchaseLimitWindowDays ?? null;
    }
    if (body.minimumDeviceCount !== undefined) data.minimumDeviceCount = body.minimumDeviceCount ?? null;
    if (body.minimumTerminalCount !== undefined) data.minimumTerminalCount = body.minimumTerminalCount ?? null;
    if (body.maxDeviceCount !== undefined) data.maxDeviceCount = body.maxDeviceCount ?? null;
    if (body.maxTerminalCount !== undefined) data.maxTerminalCount = body.maxTerminalCount ?? null;
    if (body.status !== undefined) data.status = body.status;

    const nextMinimumPurchaseUnits =
      data.minimumPurchaseUnits !== undefined ? Number(data.minimumPurchaseUnits) : existing.minimumPurchaseUnits;
    const nextMaximumPurchaseUnits =
      data.maximumPurchaseUnits !== undefined
        ? (data.maximumPurchaseUnits as number | null)
        : existing.maximumPurchaseUnits;
    if (nextMaximumPurchaseUnits != null && nextMinimumPurchaseUnits > nextMaximumPurchaseUnits)
      throw new BadRequestError("minimumPurchaseUnits cannot be greater than maximumPurchaseUnits");

    this.ensureAtLeastOneOfferedUnit(nextDevicePrice, nextTerminalPrice);

    const updated = await this.productRepository.updateTemplate(id, data);

    await this.businessLogService.logOperation({
      operationType: OperationType.REMOTE_TERMINAL_PRODUCT_TEMPLATE_UPDATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceType: "REMOTE_TERMINAL_PRODUCT_TEMPLATE",
      targetResourceId: updated.id,
      description: `Updated remote terminal product template '${updated.name}'`,
      changes: body,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toTemplateDto(updated);
  }

  public async publishTemplate(
    id: string,
    actorUserId: string,
    request?: TypedRequest,
  ): Promise<RemoteTerminalProductTemplateDto> {
    const existing = await this.productRepository.findTemplateById(id);
    if (!existing || existing.status === MANAGED_STATUS.DELETED) throw new NotFoundError("Template not found");
    if (existing.status !== MANAGED_STATUS.ENABLED)
      throw new BadRequestError("Only enabled templates can be published");

    const updated = await this.productRepository.updateTemplate(id, {
      publishStatus: "published",
      publishedAt: new Date(),
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.REMOTE_TERMINAL_PRODUCT_TEMPLATE_PUBLISH,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceType: "REMOTE_TERMINAL_PRODUCT_TEMPLATE",
      targetResourceId: updated.id,
      description: `Published remote terminal product template '${updated.name}'`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toTemplateDto(updated);
  }

  public async unpublishTemplate(
    id: string,
    actorUserId: string,
    request?: TypedRequest,
  ): Promise<RemoteTerminalProductTemplateDto> {
    const existing = await this.productRepository.findTemplateById(id);
    if (!existing || existing.status === MANAGED_STATUS.DELETED) throw new NotFoundError("Template not found");

    const updated = await this.productRepository.updateTemplate(id, {
      publishStatus: "draft",
      publishedAt: null,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.REMOTE_TERMINAL_PRODUCT_TEMPLATE_UNPUBLISH,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceType: "REMOTE_TERMINAL_PRODUCT_TEMPLATE",
      targetResourceId: updated.id,
      description: `Unpublished remote terminal product template '${updated.name}'`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toTemplateDto(updated);
  }

  public async deleteTemplate(id: string, actorUserId: string, request?: TypedRequest): Promise<void> {
    const existing = await this.productRepository.findTemplateById(id);
    if (!existing || existing.status === MANAGED_STATUS.DELETED) throw new NotFoundError("Template not found");

    await this.productRepository.softDeleteTemplate(id);
    await this.businessLogService.logOperation({
      operationType: OperationType.REMOTE_TERMINAL_PRODUCT_TEMPLATE_DELETE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceType: "REMOTE_TERMINAL_PRODUCT_TEMPLATE",
      targetResourceId: id,
      description: `Deleted remote terminal product template '${existing.name}'`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  public async listEntitlements(
    page?: number,
    pageSize?: number,
    userId?: string,
    templateId?: string,
    status?: number,
  ): Promise<RemoteTerminalUserEntitlementListResponse> {
    const pagination = normalizePagination(page, pageSize);
    const result = await this.productRepository.listEntitlements(
      {
        status: status !== undefined ? status : { gte: MANAGED_STATUS.DISABLED },
        ...(userId ? { userId } : {}),
        ...(templateId ? { templateId } : {}),
      },
      pagination.page,
      pagination.pageSize,
    );

    const usernamesById = await this.getUsernamesByIds(result.records.map((item) => item.assignedBy));
    return {
      total: result.total,
      records: result.records.map((item) => this.toEntitlementDto(item, usernamesById)),
      page: pagination.page,
      pageSize: pagination.pageSize,
    };
  }

  public async listCurrentUserEntitlements(
    userId: string,
    page?: number,
    pageSize?: number,
    status?: number,
  ): Promise<RemoteTerminalUserEntitlementListResponse> {
    return this.listEntitlements(page, pageSize, userId, undefined, status);
  }

  public async assignEntitlement(
    body: AssignRemoteTerminalEntitlementRequest,
    actorUserId: string,
    request?: TypedRequest,
  ): Promise<RemoteTerminalUserEntitlementDto> {
    await this.ensureUserExists(body.userId);

    const template = body.templateId ? await this.productRepository.findTemplateById(body.templateId) : null;
    if (body.templateId && (!template || template.status === MANAGED_STATUS.DELETED))
      throw new NotFoundError("Template not found");
    if (template) await this.enforceTemplatePurchaseLimit(body.userId, template);

    const startAt = parseRequiredDate("startAt", body.startAt);
    const endAt = parseRequiredDate("endAt", body.endAt);
    this.ensureDateRange(startAt, endAt);
    const durationDays = this.calculateDurationDaysFromRange(startAt, endAt);
    const billingUnit = template ? this.validateBillingUnit(template.billingUnit) : "day";
    const purchaseUnits = this.calculatePurchaseUnitsFromDurationDays(durationDays, billingUnit);

    const deviceLimit = this.validateDeviceLimit(body.deviceLimit);
    const terminalLimit = this.validateTerminalLimit(body.terminalLimit);
    if (deviceLimit === undefined) throw new BadRequestError("deviceLimit is required");
    if (terminalLimit === undefined) throw new BadRequestError("terminalLimit is required");
    this.ensureAtLeastOneQuota(deviceLimit, terminalLimit);

    const name = body.name?.trim() || template?.name;
    if (!name) throw new BadRequestError("name is required");

    const devicePrice = template
      ? this.restoreUnitPriceFromStoredValues(billingUnit, template.devicePrice, template.deviceDailyPrice)
      : null;
    const terminalPrice = template
      ? this.restoreUnitPriceFromStoredValues(billingUnit, template.terminalPrice, template.terminalDailyPrice)
      : null;
    const deviceDailyPrice = template?.deviceDailyPrice != null ? Number(template.deviceDailyPrice) : null;
    const terminalDailyPrice = template?.terminalDailyPrice != null ? Number(template.terminalDailyPrice) : null;

    const created = await this.productRepository.createEntitlement({
      userId: body.userId,
      templateId: body.templateId ?? null,
      name,
      description: normalizeText(body.description) ?? template?.description ?? null,
      startAt,
      endAt,
      billingUnit,
      purchaseUnits,
      durationDays,
      deviceLimit,
      terminalLimit,
      purchasedDeviceCount: deviceLimit,
      purchasedTerminalCount: terminalLimit,
      devicePrice,
      terminalPrice,
      deviceDailyPrice,
      terminalDailyPrice,
      purchaseAmount: 0,
      currency: template?.currency || DEFAULT_CURRENCY,
      assignedBy: actorUserId,
      note: normalizeText(body.note) ?? null,
      status: MANAGED_STATUS.ENABLED,
    });

    const token = this.canIssueRegistrationToken(deviceLimit)
      ? await this.ensureRegistrationTokenForEntitlement(created.id)
      : undefined;
    const usernamesById = await this.getUsernamesByIds([created.assignedBy]);

    await this.businessLogService.logOperation({
      operationType: OperationType.REMOTE_TERMINAL_ASSIGNMENT_CREATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetUserId: created.userId,
      targetResourceType: "REMOTE_TERMINAL_ENTITLEMENT",
      targetResourceId: created.id,
      description: `Assigned remote terminal entitlement '${created.name}' to user '${created.user.username}'`,
      changes: body,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return {
      ...this.toEntitlementDto(
        { ...created, registrationToken: created.registrationToken } as RemoteTerminalEntitlementWithRelations,
        usernamesById,
      ),
      registrationToken: token,
    };
  }

  public async claimPublishedTemplate(
    body: ClaimRemoteTerminalProductTemplateRequest,
    userId: string,
    request?: TypedRequest,
  ): Promise<RemoteTerminalUserEntitlementDto> {
    await this.ensureUserExists(userId);

    const template = await this.productRepository.findTemplateById(body.templateId);
    if (!template || template.status !== MANAGED_STATUS.ENABLED || template.publishStatus !== "published")
      throw new NotFoundError("Published template not found");

    const billingUnit = this.validateBillingUnit(template.billingUnit);
    const minimumPurchaseUnits = template.minimumPurchaseUnits ?? 1;
    const maximumPurchaseUnits = template.maximumPurchaseUnits ?? undefined;
    const purchaseUnits = this.validatePurchaseUnits(body.purchaseUnits);
    if (purchaseUnits === undefined) throw new BadRequestError("purchaseUnits is required");
    if (purchaseUnits < minimumPurchaseUnits)
      throw new BadRequestError(`purchaseUnits must be greater than or equal to ${minimumPurchaseUnits}`);
    if (maximumPurchaseUnits != null && purchaseUnits > maximumPurchaseUnits)
      throw new BadRequestError(`purchaseUnits cannot exceed ${maximumPurchaseUnits}`);
    const durationDays = this.calculateDurationDaysFromPurchaseUnits(purchaseUnits, billingUnit);
    this.validateDurationDays(durationDays);
    const deviceCount = this.validateDeviceLimit(body.deviceCount);
    const terminalCount = this.validateTerminalLimit(body.terminalCount);
    if (deviceCount === undefined) throw new BadRequestError("deviceCount is required");
    if (terminalCount === undefined) throw new BadRequestError("terminalCount is required");
    this.ensureAtLeastOneQuota(deviceCount, terminalCount);

    const devicePrice = this.restoreUnitPriceFromStoredValues(
      billingUnit,
      template.devicePrice,
      template.deviceDailyPrice,
    );
    const terminalPrice = this.restoreUnitPriceFromStoredValues(
      billingUnit,
      template.terminalPrice,
      template.terminalDailyPrice,
    );
    const deviceDailyPrice = template.deviceDailyPrice != null ? Number(template.deviceDailyPrice) : null;
    const terminalDailyPrice = template.terminalDailyPrice != null ? Number(template.terminalDailyPrice) : null;
    this.ensureUnitSupported("deviceCount", deviceCount, devicePrice);
    this.ensureUnitSupported("terminalCount", terminalCount, terminalPrice);

    if (template.maxDeviceCount != null && deviceCount > template.maxDeviceCount)
      throw new BadRequestError(`deviceCount cannot exceed ${template.maxDeviceCount} for this template`);
    if (template.maxTerminalCount != null && terminalCount > template.maxTerminalCount)
      throw new BadRequestError(`terminalCount cannot exceed ${template.maxTerminalCount} for this template`);
    const targetEntitlementId = body.targetEntitlementId?.trim() || undefined;
    if (!targetEntitlementId) {
      if (template.minimumDeviceCount != null && deviceCount < template.minimumDeviceCount)
        throw new BadRequestError(`deviceCount must be at least ${template.minimumDeviceCount} for this template`);
      if (template.minimumTerminalCount != null && terminalCount < template.minimumTerminalCount)
        throw new BadRequestError(`terminalCount must be at least ${template.minimumTerminalCount} for this template`);
    }
    if (!targetEntitlementId) await this.enforceTemplatePurchaseLimit(userId, template);

    const purchaseAmount = this.calculatePurchaseAmount({
      durationDays,
      billingUnit,
      deviceCount,
      terminalCount,
      devicePrice,
      terminalPrice,
    });

    let record: RemoteTerminalEntitlementWithRelations;
    let token: RemoteTerminalRegistrationTokenDto | undefined;

    if (targetEntitlementId) {
      const existing = await this.productRepository.findEntitlementById(targetEntitlementId);
      if (!existing || existing.status === MANAGED_STATUS.DELETED)
        throw new NotFoundError("Target entitlement not found");
      if (existing.userId !== userId) throw new ForbiddenError("You do not have access to this entitlement");
      if (existing.status !== MANAGED_STATUS.ENABLED)
        throw new BadRequestError("Only enabled entitlements can be renewed or upgraded");
      if (existing.templateId !== template.id)
        throw new BadRequestError("Target entitlement must belong to the selected template");

      this.ensureMergedQuotaTargets(existing, deviceCount, terminalCount);

      const { startAt, endAt } = this.buildMergedEntitlementRange(existing.startAt, existing.endAt, durationDays);
      const nextDurationDays = this.calculateDurationDaysFromRange(startAt, endAt);
      const nextPurchaseUnits = this.calculatePurchaseUnitsFromDurationDays(nextDurationDays, billingUnit);
      const mergedPurchaseAmount = this.calculateMergedPurchaseAmount({
        existing,
        durationDays,
        billingUnit,
        deviceCount,
        terminalCount,
        devicePrice,
        terminalPrice,
      });
      const cumulativePurchaseAmount = Number((Number(existing.purchaseAmount ?? 0) + mergedPurchaseAmount).toFixed(4));

      record = await this.productRepository.purchaseAndUpdateEntitlement({
        userId,
        templateName: template.name,
        description: template.description ?? undefined,
        entitlementId: existing.id,
        entitlement: {
          name: body.name?.trim() || existing.name,
          description: existing.description ?? template.description ?? null,
          startAt,
          endAt,
          billingUnit,
          purchaseUnits: nextPurchaseUnits,
          durationDays: nextDurationDays,
          deviceLimit: deviceCount,
          terminalLimit: terminalCount,
          purchasedDeviceCount: deviceCount,
          purchasedTerminalCount: terminalCount,
          devicePrice,
          terminalPrice,
          deviceDailyPrice,
          terminalDailyPrice,
          purchaseAmount: cumulativePurchaseAmount,
          currency: template.currency || DEFAULT_CURRENCY,
          assignedBy: userId,
          note: DEFAULT_SELF_CLAIM_NOTE,
          status: MANAGED_STATUS.ENABLED,
        },
      });

      token =
        this.canIssueRegistrationToken(deviceCount) && !record.registrationToken
          ? await this.ensureRegistrationTokenForEntitlement(record.id)
          : this.canIssueRegistrationToken(deviceCount) && record.registrationToken
            ? this.toRegistrationTokenDto(record.registrationToken)
            : undefined;
    } else {
      const { startAt, endAt } = this.buildTemplateEntitlementRange(durationDays);
      record = await this.productRepository.purchaseEntitlement({
        userId,
        templateName: template.name,
        description: template.description ?? undefined,
        entitlement: {
          userId,
          templateId: template.id,
          name: body.name?.trim() || template.name,
          description: template.description ?? null,
          startAt,
          endAt,
          billingUnit,
          purchaseUnits,
          durationDays,
          deviceLimit: deviceCount,
          terminalLimit: terminalCount,
          purchasedDeviceCount: deviceCount,
          purchasedTerminalCount: terminalCount,
          devicePrice,
          terminalPrice,
          deviceDailyPrice,
          terminalDailyPrice,
          purchaseAmount,
          currency: template.currency || DEFAULT_CURRENCY,
          assignedBy: userId,
          note: DEFAULT_SELF_CLAIM_NOTE,
          status: MANAGED_STATUS.ENABLED,
        },
      });

      token = this.canIssueRegistrationToken(deviceCount)
        ? await this.ensureRegistrationTokenForEntitlement(record.id)
        : undefined;
    }

    const usernamesById = await this.getUsernamesByIds([record.assignedBy]);

    await this.businessLogService.logOperation({
      operationType: OperationType.REMOTE_TERMINAL_ASSIGNMENT_SELF_CLAIM,
      operationCategory: OperationCategory.RELAY,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceType: "REMOTE_TERMINAL_ENTITLEMENT",
      targetResourceId: record.id,
      description: targetEntitlementId
        ? `User renewed or upgraded remote terminal entitlement '${record.name}' from template '${template.name}'`
        : `User self-claimed remote terminal product template '${template.name}'`,
      changes: body,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return {
      ...this.toEntitlementDto(record, usernamesById),
      registrationToken: token,
    };
  }

  public async updateEntitlement(
    id: string,
    body: UpdateRemoteTerminalEntitlementRequest,
    actorUserId: string,
    request?: TypedRequest,
  ): Promise<RemoteTerminalUserEntitlementDto> {
    const existing = await this.productRepository.findEntitlementById(id);
    if (!existing || existing.status === MANAGED_STATUS.DELETED) throw new NotFoundError("Entitlement not found");

    const startAt = parseOptionalDate("startAt", body.startAt);
    const endAt = parseOptionalDate("endAt", body.endAt);
    const nextStartAt = startAt ?? existing.startAt;
    const nextEndAt = endAt ?? existing.endAt;
    this.ensureDateRange(nextStartAt, nextEndAt);
    const nextDurationDays = this.calculateDurationDaysFromRange(nextStartAt, nextEndAt);
    const nextBillingUnit = this.validateBillingUnit(existing.billingUnit);
    const nextPurchaseUnits = this.calculatePurchaseUnitsFromDurationDays(nextDurationDays, nextBillingUnit);

    const nextDeviceLimit = this.validateDeviceLimit(body.deviceLimit ?? existing.deviceLimit);
    const nextTerminalLimit = this.validateTerminalLimit(body.terminalLimit ?? existing.terminalLimit);
    if (nextDeviceLimit === undefined) throw new BadRequestError("deviceLimit is required");
    if (nextTerminalLimit === undefined) throw new BadRequestError("terminalLimit is required");
    this.ensureAtLeastOneQuota(nextDeviceLimit, nextTerminalLimit);
    if (existing.devices.length > nextDeviceLimit)
      throw new BadRequestError("deviceLimit cannot be lower than current registered device count");

    const updateData: Prisma.RemoteTerminalUserEntitlementUncheckedUpdateInput = {
      name: body.name?.trim(),
      description: body.description !== undefined ? (normalizeText(body.description) ?? null) : undefined,
      purchaseUnits: nextPurchaseUnits,
      durationDays: nextDurationDays,
      deviceLimit: nextDeviceLimit,
      terminalLimit: nextTerminalLimit,
      note: body.note !== undefined ? (normalizeText(body.note) ?? null) : undefined,
      status: body.status,
    };
    if (startAt !== undefined && startAt !== null) updateData.startAt = startAt;
    if (endAt !== undefined && endAt !== null) updateData.endAt = endAt;
    if (body.maxDeviceCount !== undefined) updateData.maxDeviceCount = body.maxDeviceCount;
    if (body.maxTerminalCount !== undefined) updateData.maxTerminalCount = body.maxTerminalCount;

    const updated = await this.productRepository.updateEntitlement(id, updateData);

    const usernamesById = await this.getUsernamesByIds([updated.assignedBy]);
    const ensuredToken =
      this.canIssueRegistrationToken(nextDeviceLimit) && !updated.registrationToken
        ? await this.ensureRegistrationTokenForEntitlement(updated.id)
        : undefined;
    await this.businessLogService.logOperation({
      operationType: OperationType.REMOTE_TERMINAL_ASSIGNMENT_UPDATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetUserId: updated.userId,
      targetResourceType: "REMOTE_TERMINAL_ENTITLEMENT",
      targetResourceId: updated.id,
      description: `Updated remote terminal entitlement '${updated.name}'`,
      changes: body,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return {
      ...this.toEntitlementDto(updated, usernamesById),
      registrationToken:
        ensuredToken ??
        (this.canIssueRegistrationToken(nextDeviceLimit) && updated.registrationToken
          ? this.toRegistrationTokenDto(updated.registrationToken)
          : undefined),
    };
  }

  public async deleteEntitlement(id: string, actorUserId: string, request?: TypedRequest): Promise<void> {
    const existing = await this.productRepository.findEntitlementById(id);
    if (!existing || existing.status === MANAGED_STATUS.DELETED) throw new NotFoundError("Entitlement not found");

    await this.productRepository.softDeleteEntitlement(id);
    await this.businessLogService.logOperation({
      operationType: OperationType.REMOTE_TERMINAL_ASSIGNMENT_DELETE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetUserId: existing.userId,
      targetResourceType: "REMOTE_TERMINAL_ENTITLEMENT",
      targetResourceId: id,
      description: `Deleted remote terminal entitlement '${existing.name}'`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  public async rotateRegistrationToken(
    entitlementId: string,
    body: RotateRemoteTerminalRegistrationTokenRequest,
    actorUserId: string,
    request?: TypedRequest,
  ): Promise<RemoteTerminalRegistrationTokenDto> {
    const entitlement = await this.productRepository.findEntitlementById(entitlementId);
    if (!entitlement || entitlement.status === MANAGED_STATUS.DELETED) throw new NotFoundError("Entitlement not found");
    if (!this.canIssueRegistrationToken(entitlement.deviceLimit))
      throw new BadRequestError("Registration token is unavailable when deviceLimit is 0");

    const nextLabel =
      body.label !== undefined ? (normalizeText(body.label) ?? null) : (entitlement.registrationToken?.label ?? null);
    const nextExpiresAt =
      body.expiresAt !== undefined
        ? (parseOptionalDate("expiresAt", body.expiresAt) ?? null)
        : (entitlement.registrationToken?.expiresAt ?? null);

    const rotated = await this.productRepository.upsertEntitlementToken(entitlementId, {
      entitlementId,
      token: this.buildRandomToken(),
      label: nextLabel,
      expiresAt: nextExpiresAt,
      status: MANAGED_STATUS.ENABLED,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.REMOTE_TERMINAL_REGISTRATION_TOKEN_ROTATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetUserId: entitlement.userId,
      targetResourceType: "REMOTE_TERMINAL_REGISTRATION_TOKEN",
      targetResourceId: rotated.id,
      description: `Rotated remote terminal registration token for entitlement '${entitlement.name}'`,
      changes: { entitlementId, label: body.label, expiresAt: body.expiresAt },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toRegistrationTokenDto(rotated);
  }

  public async rotateCurrentUserRegistrationToken(
    userId: string,
    entitlementId: string,
    body: RotateRemoteTerminalRegistrationTokenRequest,
    request?: TypedRequest,
  ): Promise<RemoteTerminalRegistrationTokenDto> {
    const entitlement = await this.productRepository.findEntitlementById(entitlementId);
    if (!entitlement || entitlement.status === MANAGED_STATUS.DELETED) throw new NotFoundError("Entitlement not found");
    if (entitlement.userId !== userId) throw new ForbiddenError("You can only rotate your own registration token");

    return this.rotateRegistrationToken(entitlementId, body, userId, request);
  }

  public async issueInstallToken(userId: string, entitlementId: string): Promise<RemoteTerminalInstallTokenDto> {
    const entitlement = await this.productRepository.findEntitlementById(entitlementId);
    if (!entitlement || entitlement.status === MANAGED_STATUS.DELETED) throw new NotFoundError("Entitlement not found");
    if (entitlement.userId !== userId)
      throw new ForbiddenError("You can only issue install tokens for your own entitlement");
    if (!this.canIssueRegistrationToken(entitlement.deviceLimit))
      throw new BadRequestError("Registration token is unavailable when deviceLimit is 0");
    const secret = String(process.env.RTM_INSTALL_TOKEN_SECRET || "").trim();
    if (!secret || secret.length < 64) throw new Error("RTM_INSTALL_TOKEN_SECRET must be at least 64 characters");
    return buildInstallToken(entitlementId, secret);
  }

  public async listDevices(
    page?: number,
    pageSize?: number,
    userId?: string,
    entitlementId?: string,
    status?: number,
  ): Promise<RemoteTerminalBoundDeviceListResponse> {
    const pagination = normalizePagination(page, pageSize);
    const result = await this.productRepository.listDeviceBindings(
      {
        status: status !== undefined ? status : { gte: MANAGED_STATUS.DISABLED },
        ...(userId ? { userId } : {}),
        ...(entitlementId ? { entitlementId } : {}),
      },
      pagination.page,
      pagination.pageSize,
    );

    return {
      total: result.total,
      records: result.records.map((item) => this.toDeviceDto(item)),
      page: pagination.page,
      pageSize: pagination.pageSize,
    };
  }

  public async listCurrentUserDevices(
    userId: string,
    page?: number,
    pageSize?: number,
    status?: number,
  ): Promise<RemoteTerminalBoundDeviceListResponse> {
    return this.listDevices(page, pageSize, userId, undefined, status);
  }

  public async revokeDevice(id: string, actorUserId: string, request?: TypedRequest): Promise<void> {
    const existing = await this.productRepository.findDeviceBindingById(id);
    if (!existing || existing.status === MANAGED_STATUS.DELETED) throw new NotFoundError("Device binding not found");

    await this.assertDeviceUnbindAllowed(existing);

    await this.productRepository.updateDeviceBinding(id, {
      status: MANAGED_STATUS.DELETED,
      online: false,
    });
    await this.businessLogService.logOperation({
      operationType: OperationType.REMOTE_TERMINAL_DEVICE_REVOKE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetUserId: existing.userId,
      targetResourceType: "REMOTE_TERMINAL_DEVICE_BINDING",
      targetResourceId: id,
      description: `Revoked remote terminal device '${existing.hostname}'`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  public async revokeCurrentUserDevice(userId: string, id: string, request?: TypedRequest): Promise<void> {
    const existing = await this.productRepository.findDeviceBindingById(id);
    if (!existing || existing.status === MANAGED_STATUS.DELETED) throw new NotFoundError("Device binding not found");
    if (existing.userId !== userId) throw new ForbiddenError("You cannot revoke this device");

    await this.assertDeviceUnbindAllowed(existing);

    await this.productRepository.updateDeviceBinding(id, {
      status: MANAGED_STATUS.DELETED,
      online: false,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.REMOTE_TERMINAL_DEVICE_REVOKE,
      operationCategory: OperationCategory.RELAY,
      actorUserId: userId,
      targetUserId: existing.userId,
      targetResourceType: "REMOTE_TERMINAL_DEVICE_BINDING",
      targetResourceId: id,
      description: `User revoked remote terminal device '${existing.hostname}'`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  public async adminRevokeDevice(id: string, actorUserId: string, request?: TypedRequest): Promise<void> {
    const existing = await this.productRepository.findDeviceBindingById(id);
    if (!existing || existing.status === MANAGED_STATUS.DELETED) throw new NotFoundError("Device binding not found");

    await this.productRepository.updateDeviceBinding(id, {
      status: MANAGED_STATUS.DELETED,
      online: false,
    });
    await this.businessLogService.logOperation({
      operationType: OperationType.REMOTE_TERMINAL_DEVICE_REVOKE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetUserId: existing.userId,
      targetResourceType: "REMOTE_TERMINAL_DEVICE_BINDING",
      targetResourceId: id,
      description: `Admin revoked remote terminal device '${existing.hostname}'`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  public async resetUnbindCount(entitlementId: string, actorUserId: string, request?: TypedRequest): Promise<void> {
    const existing = await this.productRepository.findEntitlementById(entitlementId);
    if (!existing || existing.status === MANAGED_STATUS.DELETED) throw new NotFoundError("Entitlement not found");

    const now = new Date();
    await this.productRepository.updateEntitlement(entitlementId, { unbindResetAt: now });

    await this.businessLogService.logOperation({
      operationType: OperationType.REMOTE_TERMINAL_DEVICE_REVOKE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetUserId: existing.userId,
      targetResourceType: "REMOTE_TERMINAL_USER_ENTITLEMENT",
      targetResourceId: entitlementId,
      description: `Reset device unbind count for entitlement '${existing.name}'`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  public async listRuntimeAccessibleDevices(userId: string): Promise<RemoteTerminalBoundDeviceDto[]> {
    const records = await this.productRepository.listAccessibleDeviceBindings(userId, new Date());
    return records.map((item) => this.toDeviceDto(item));
  }

  public async getRuntimeAccessibleDevice(
    userId: string,
    deviceId: string,
  ): Promise<RemoteTerminalDeviceBindingWithRelations> {
    const record = await this.productRepository.findAccessibleDeviceBindingByDeviceId(userId, deviceId, new Date());
    if (!record) throw new ForbiddenError("Device is not available for current user");
    return record;
  }
}

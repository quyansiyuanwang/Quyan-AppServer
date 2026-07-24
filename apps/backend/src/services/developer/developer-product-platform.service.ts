/* eslint-disable no-restricted-imports, no-restricted-syntax -- Product quota, balance, entitlement, and call-log updates require one transaction boundary. */
import { createHash, randomBytes } from "crypto";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { DEVELOPER_PRODUCT_CODES, isDeveloperProductCode, type DeveloperProductCode } from "@appserver/shared";
import { prisma } from "@/config/database";
import { Permission } from "@/constant/permission";
import { CustomCode } from "@/constant/custom-code";
import { DeveloperProjectService } from "@/services/developer/developer-project.service";
import { PermissionService } from "@/services/users/permission.service";
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from "@/util/errors";
import type {
  CreateDeveloperProductApiKeyDto,
  CreateDeveloperProductInstanceDto,
  DeveloperProductSubjectDto,
  DeveloperProductApiKeyDto,
  DeveloperProductConfigDto,
  DeveloperProductCallLogDto,
  DeveloperProductEntitlementDto,
  DeveloperProductInstanceDto,
  DeveloperProductUsageDto,
  UpdateDeveloperProductConfigDto,
  UpsertDeveloperProductEntitlementDto,
} from "@/api/dto/developer/product-platform.dto";

const PRODUCT_KEY_PREFIX = "dpk_";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const asIso = (value: Date | null | undefined) => value?.toISOString();

const PRODUCT_PERMISSIONS: Record<DeveloperProductCode, Permission[]> = {
  kv: [Permission.PRODUCT_KV_READ, Permission.PRODUCT_KV_WRITE, Permission.PRODUCT_KV_MANAGE],
  short_link: [
    Permission.PRODUCT_SHORT_LINK_READ,
    Permission.PRODUCT_SHORT_LINK_WRITE,
    Permission.PRODUCT_SHORT_LINK_MANAGE,
  ],
  secret: [
    Permission.PRODUCT_SECRET_READ,
    Permission.PRODUCT_SECRET_WRITE,
    Permission.PRODUCT_SECRET_USE,
    Permission.PRODUCT_SECRET_MANAGE,
  ],
  status: [
    Permission.PRODUCT_STATUS_READ,
    Permission.PRODUCT_STATUS_WRITE,
    Permission.PRODUCT_STATUS_PUBLISH,
    Permission.PRODUCT_STATUS_MANAGE,
  ],
  verification: [
    Permission.PRODUCT_VERIFICATION_SEND,
    Permission.PRODUCT_VERIFICATION_VERIFY,
    Permission.PRODUCT_VERIFICATION_MANAGE,
  ],
  ip_geolocation: [Permission.PRODUCT_IP_GEOLOCATION_LOOKUP, Permission.PRODUCT_IP_GEOLOCATION_MANAGE],
  push: [
    Permission.PRODUCT_PUSH_SEND,
    Permission.PRODUCT_PUSH_CHANNEL_MANAGE,
    Permission.PRODUCT_PUSH_DELIVERY_READ,
    Permission.PRODUCT_PUSH_MANAGE,
  ],
};

export interface ProductKeyContext {
  keyId: string;
  instanceId: string;
  backingProjectId: string;
  entitlementId: string;
  productCode: DeveloperProductCode;
  subjectUserId: string;
  accountOwnerId: string;
  actions: Permission[];
}

type ProductQuotaReceipt = {
  usageId: string;
  entitlementId: string;
  accountOwnerId: string;
  chargeAmount: number;
};

export class DeveloperProductPlatformService {
  private static instance: DeveloperProductPlatformService;
  private readonly projectService = DeveloperProjectService.getInstance();
  private readonly permissionService = PermissionService.getInstance();

  static getInstance(): DeveloperProductPlatformService {
    if (!this.instance) this.instance = new DeveloperProductPlatformService();
    return this.instance;
  }

  private productPermissions(productCode: DeveloperProductCode): Permission[] {
    return PRODUCT_PERMISSIONS[productCode];
  }

  private accountOwnerId(user: { id: string; accountOwnerId: string | null }): string {
    return user.accountOwnerId || user.id;
  }

  private async ensureConfigs(): Promise<void> {
    await Promise.all(
      DEVELOPER_PRODUCT_CODES.map((productCode) =>
        prisma.developerProductConfig.upsert({
          where: { productCode },
          update: {},
          create: { productCode, enabled: false, defaultDailyQuota: 0, defaultInstanceLimit: 1, retentionDays: 30 },
        }),
      ),
    );
  }

  private configDto(config: any): DeveloperProductConfigDto {
    return {
      productCode: config.productCode as DeveloperProductCode,
      enabled: config.enabled,
      defaultDailyQuota: config.defaultDailyQuota,
      overagePrice: Number(config.overagePrice),
      defaultInstanceLimit: config.defaultInstanceLimit,
      retentionDays: config.retentionDays,
      resourceLimits: (config.resourceLimits as Record<string, unknown> | null) ?? undefined,
      settings: (config.settings as Record<string, unknown> | null) ?? undefined,
    };
  }

  private entitlementDto(entitlement: any): DeveloperProductEntitlementDto {
    return {
      id: entitlement.id,
      accountOwnerId: entitlement.accountOwnerId,
      productCode: entitlement.productCode as DeveloperProductCode,
      enabled: entitlement.enabled,
      dailyFreeQuota: entitlement.dailyFreeQuota ?? undefined,
      overageEnabled: entitlement.overageEnabled,
      instanceLimit: entitlement.instanceLimit,
      startsAt: asIso(entitlement.startsAt),
      expiresAt: asIso(entitlement.expiresAt),
      ownerPolicyId: entitlement.ownerPolicyId ?? undefined,
      createTime: entitlement.createTime.toISOString(),
      updateTime: entitlement.updateTime.toISOString(),
    };
  }

  private instanceDto(instance: any): DeveloperProductInstanceDto {
    return {
      id: instance.id,
      productCode: instance.entitlement.productCode as DeveloperProductCode,
      entitlementId: instance.entitlementId,
      name: instance.name,
      slug: instance.slug,
      enabled: instance.enabled,
      createTime: instance.createTime.toISOString(),
      updateTime: instance.updateTime.toISOString(),
    };
  }

  private keyDto(key: any, rawKey?: string): DeveloperProductApiKeyDto {
    return {
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      subjectUserId: key.subjectUserId,
      actions: this.readActions(key.actions),
      expiresAt: asIso(key.expiresAt),
      lastUsedAt: asIso(key.lastUsedAt),
      requestCount: key.requestCount,
      ...(rawKey ? { key: rawKey } : {}),
    };
  }

  private readActions(value: unknown): Permission[] {
    return Array.isArray(value)
      ? value.filter(
          (item): item is Permission =>
            typeof item === "string" && Object.values(Permission).includes(item as Permission),
        )
      : [];
  }

  private async getActiveEntitlement(accountOwnerId: string, productCode: DeveloperProductCode): Promise<any> {
    const entitlement = await prisma.developerProductEntitlement.findUnique({
      where: { accountOwnerId_productCode: { accountOwnerId, productCode } },
    });
    if (!entitlement || entitlement.status !== 1 || !entitlement.enabled)
      throw new ForbiddenError("产品尚未分发给该账号");
    const now = new Date();
    if ((entitlement.startsAt && entitlement.startsAt > now) || (entitlement.expiresAt && entitlement.expiresAt <= now))
      throw new ForbiddenError("产品授权当前不可用");
    return entitlement;
  }

  private async assertProductPermission(
    actorUserId: string,
    productCode: DeveloperProductCode,
    required: Permission,
  ): Promise<void> {
    const permissions = await this.permissionService.getUserFullPermissions(actorUserId);
    if (!permissions?.effectivePermissions.includes(required)) throw new ForbiddenError("RAM 权限不足，无法操作该产品");
    const user = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, accountOwnerId: true },
    });
    if (!user) throw new UnauthorizedError("用户不存在");
    await this.getActiveEntitlement(this.accountOwnerId(user), productCode);
  }

  async listConfigs(): Promise<DeveloperProductConfigDto[]> {
    await this.ensureConfigs();
    const configs = await prisma.developerProductConfig.findMany({ orderBy: { productCode: "asc" } });
    return configs.map((config) => this.configDto(config));
  }

  async updateConfig(
    productCode: DeveloperProductCode,
    body: UpdateDeveloperProductConfigDto,
  ): Promise<DeveloperProductConfigDto> {
    const jsonInput = (value?: Record<string, unknown>): Prisma.InputJsonValue | undefined =>
      value as Prisma.InputJsonValue | undefined;
    const config = await prisma.developerProductConfig.upsert({
      where: { productCode },
      create: {
        ...body,
        productCode,
        overagePrice: new Decimal(body.overagePrice),
        resourceLimits: jsonInput(body.resourceLimits),
        settings: jsonInput(body.settings),
      },
      update: {
        ...body,
        overagePrice: new Decimal(body.overagePrice),
        resourceLimits: jsonInput(body.resourceLimits),
        settings: jsonInput(body.settings),
      },
    });
    return this.configDto(config);
  }

  async listEntitlements(productCode?: DeveloperProductCode): Promise<DeveloperProductEntitlementDto[]> {
    const entitlements = await prisma.developerProductEntitlement.findMany({
      where: productCode ? { productCode } : undefined,
      orderBy: { updateTime: "desc" },
    });
    return entitlements.map((entitlement) => this.entitlementDto(entitlement));
  }

  async upsertEntitlement(
    productCode: DeveloperProductCode,
    body: UpsertDeveloperProductEntitlementDto,
    issuedByUserId: string,
  ): Promise<DeveloperProductEntitlementDto> {
    const owner = await prisma.user.findUnique({
      where: { id: body.accountOwnerId },
      select: { id: true, accountOwnerId: true },
    });
    if (!owner || owner.accountOwnerId) throw new NotFoundError("主账号不存在");
    const startsAt = body.startsAt ? new Date(body.startsAt) : null;
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (startsAt && expiresAt && startsAt >= expiresAt) throw new BadRequestError("授权结束时间必须晚于开始时间");
    const permissions = this.productPermissions(productCode);
    const policyName = `system-product-${productCode}-owner`;
    const policy = await prisma.ramPolicy.upsert({
      where: { accountOwnerId_activeName: { accountOwnerId: owner.id, activeName: policyName } },
      create: {
        accountOwnerId: owner.id,
        name: policyName,
        activeName: policyName,
        description: `系统托管：${productCode} 产品所有者权限`,
        permissions,
        type: "managed_product_owner",
      },
      update: {
        permissions,
        description: `系统托管：${productCode} 产品所有者权限`,
        type: "managed_product_owner",
        status: 1,
      },
    });
    await prisma.ramPolicyAttachment.upsert({
      where: {
        accountOwnerId_policyId_targetType_targetId: {
          accountOwnerId: owner.id,
          policyId: policy.id,
          targetType: "user",
          targetId: owner.id,
        },
      },
      create: { accountOwnerId: owner.id, policyId: policy.id, targetType: "user", targetId: owner.id },
      update: { status: 1 },
    });
    const entitlement = await prisma.developerProductEntitlement.upsert({
      where: { accountOwnerId_productCode: { accountOwnerId: owner.id, productCode } },
      create: {
        accountOwnerId: owner.id,
        productCode,
        enabled: body.enabled ?? true,
        dailyFreeQuota: body.dailyFreeQuota ?? null,
        overageEnabled: body.overageEnabled ?? false,
        instanceLimit: body.instanceLimit ?? 1,
        startsAt,
        expiresAt,
        issuedByUserId,
        ownerPolicyId: policy.id,
      },
      update: {
        enabled: body.enabled,
        dailyFreeQuota: body.dailyFreeQuota,
        overageEnabled: body.overageEnabled,
        instanceLimit: body.instanceLimit,
        startsAt,
        expiresAt,
        issuedByUserId,
        ownerPolicyId: policy.id,
        status: 1,
      },
    });
    return this.entitlementDto(entitlement);
  }

  async listOwnEntitlements(actorUserId: string): Promise<DeveloperProductEntitlementDto[]> {
    const user = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, accountOwnerId: true },
    });
    if (!user) throw new UnauthorizedError("用户不存在");
    return this.listEntitlementsForOwner(this.accountOwnerId(user));
  }

  private async listEntitlementsForOwner(accountOwnerId: string): Promise<DeveloperProductEntitlementDto[]> {
    const entitlements = await prisma.developerProductEntitlement.findMany({
      where: { accountOwnerId, status: 1 },
      orderBy: { productCode: "asc" },
    });
    return entitlements.map((entitlement) => this.entitlementDto(entitlement));
  }

  async listInstances(actorUserId: string, productCode: DeveloperProductCode): Promise<DeveloperProductInstanceDto[]> {
    await this.assertProductPermission(actorUserId, productCode, this.productPermissions(productCode).at(-1)!);
    const user = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, accountOwnerId: true },
    });
    const entitlement = await this.getActiveEntitlement(this.accountOwnerId(user!), productCode);
    const instances = await prisma.developerProductInstance.findMany({
      where: { entitlementId: entitlement.id, status: 1 },
      include: { entitlement: { select: { productCode: true } } },
      orderBy: { createTime: "desc" },
    });
    return instances.map((instance) => this.instanceDto(instance));
  }

  async createInstance(
    actorUserId: string,
    productCode: DeveloperProductCode,
    body: CreateDeveloperProductInstanceDto,
  ): Promise<DeveloperProductInstanceDto> {
    await this.assertProductPermission(actorUserId, productCode, this.productPermissions(productCode).at(-1)!);
    const user = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, accountOwnerId: true },
    });
    const ownerId = this.accountOwnerId(user!);
    const entitlement = await this.getActiveEntitlement(ownerId, productCode);
    const activeCount = await prisma.developerProductInstance.count({
      where: { entitlementId: entitlement.id, status: 1 },
    });
    if (activeCount >= entitlement.instanceLimit) throw new ForbiddenError("产品实例数量已达到授权上限");
    const suffix = randomBytes(5).toString("hex");
    const instance = await prisma.$transaction(async (tx) => {
      const backingProject = await tx.developerProject.create({
        data: {
          userId: ownerId,
          name: `[product:${productCode}] ${body.name}`,
          slug: `product-${productCode}-${body.slug}-${suffix}`.slice(0, 80),
          description: "Internal backing project for the product platform",
          dailyFreeQuota: 0,
          overageEnabled: false,
        },
      });
      return tx.developerProductInstance.create({
        data: { entitlementId: entitlement.id, name: body.name, slug: body.slug, backingProjectId: backingProject.id },
        include: { entitlement: { select: { productCode: true } } },
      });
    });
    return this.instanceDto(instance);
  }

  private async getAuthorizedInstance(
    actorUserId: string,
    productCode: DeveloperProductCode,
    instanceId: string,
    permission: Permission,
  ): Promise<any> {
    await this.assertProductPermission(actorUserId, productCode, permission);
    const instance = await prisma.developerProductInstance.findFirst({
      where: { id: instanceId, status: 1, enabled: true, entitlement: { productCode, status: 1 } },
      include: { entitlement: true },
    });
    if (!instance) throw new NotFoundError("产品实例不存在");
    const user = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, accountOwnerId: true },
    });
    if (!user || instance.entitlement.accountOwnerId !== this.accountOwnerId(user))
      throw new NotFoundError("产品实例不存在");
    await this.getActiveEntitlement(instance.entitlement.accountOwnerId, productCode);
    return instance;
  }

  async getManagementContext(
    actorUserId: string,
    productCode: DeveloperProductCode,
    instanceId: string,
    permission: Permission,
  ): Promise<{ backingProjectId: string; accountOwnerId: string }> {
    const instance = await this.getAuthorizedInstance(actorUserId, productCode, instanceId, permission);
    return { backingProjectId: instance.backingProjectId, accountOwnerId: instance.entitlement.accountOwnerId };
  }

  async listKeys(
    actorUserId: string,
    productCode: DeveloperProductCode,
    instanceId: string,
  ): Promise<DeveloperProductApiKeyDto[]> {
    await this.getAuthorizedInstance(
      actorUserId,
      productCode,
      instanceId,
      this.productPermissions(productCode).at(-1)!,
    );
    const keys = await prisma.developerProductApiKey.findMany({
      where: { instanceId, status: 1 },
      orderBy: { createTime: "desc" },
    });
    return keys.map((key) => this.keyDto(key));
  }

  async listSubjects(actorUserId: string, productCode: DeveloperProductCode): Promise<DeveloperProductSubjectDto[]> {
    await this.assertProductPermission(actorUserId, productCode, this.productPermissions(productCode).at(-1)!);
    const user = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, accountOwnerId: true },
    });
    if (!user) throw new UnauthorizedError("用户不存在");
    const accountOwnerId = this.accountOwnerId(user);
    const subjects = await prisma.user.findMany({
      where: { status: 1, OR: [{ id: accountOwnerId }, { accountOwnerId }] },
      select: { id: true, username: true, displayName: true },
      orderBy: { createTime: "asc" },
    });
    return subjects.map((subject) => ({
      id: subject.id,
      username: subject.username,
      displayName: subject.displayName ?? undefined,
    }));
  }

  async createKey(
    actorUserId: string,
    productCode: DeveloperProductCode,
    instanceId: string,
    body: CreateDeveloperProductApiKeyDto,
  ): Promise<DeveloperProductApiKeyDto> {
    const instance = await this.getAuthorizedInstance(
      actorUserId,
      productCode,
      instanceId,
      this.productPermissions(productCode).at(-1)!,
    );
    const subject = await prisma.user.findUnique({
      where: { id: body.subjectUserId },
      select: { id: true, accountOwnerId: true },
    });
    if (!subject || this.accountOwnerId(subject) !== instance.entitlement.accountOwnerId)
      throw new BadRequestError("RAM 主体不属于该账号");
    const allowed = this.productPermissions(productCode);
    const actions = body.actions.filter((action): action is Permission => allowed.includes(action as Permission));
    if (!actions.length || actions.length !== new Set(body.actions).size)
      throw new BadRequestError("Key 动作不属于该产品");
    const subjectPermissions = await this.permissionService.getUserFullPermissions(subject.id);
    if (!subjectPermissions || actions.some((action) => !subjectPermissions.effectivePermissions.includes(action)))
      throw new ForbiddenError("RAM 主体未拥有所选产品权限");
    const rawKey = `${PRODUCT_KEY_PREFIX}${randomBytes(32).toString("hex")}`;
    const key = await prisma.developerProductApiKey.create({
      data: {
        instanceId,
        subjectUserId: subject.id,
        name: body.name,
        keyHash: hash(rawKey),
        keyPrefix: rawKey.slice(0, 12),
        actions,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
    });
    return this.keyDto(key, rawKey);
  }

  async revokeKey(
    actorUserId: string,
    productCode: DeveloperProductCode,
    instanceId: string,
    keyId: string,
  ): Promise<void> {
    await this.getAuthorizedInstance(
      actorUserId,
      productCode,
      instanceId,
      this.productPermissions(productCode).at(-1)!,
    );
    const result = await prisma.developerProductApiKey.updateMany({
      where: { id: keyId, instanceId, status: 1 },
      data: { status: -1 },
    });
    if (!result.count) throw new NotFoundError("产品 API Key 不存在");
  }

  async authenticateProductKey(rawKey: string, requiredActions: Permission[]): Promise<ProductKeyContext> {
    if (!rawKey.startsWith(PRODUCT_KEY_PREFIX)) throw new UnauthorizedError("未提供产品 API Key");
    const key = await prisma.developerProductApiKey.findFirst({
      where: { keyHash: hash(rawKey), status: 1 },
      include: {
        instance: { include: { entitlement: true } },
        subjectUser: { select: { id: true, status: true, accountOwnerId: true } },
      },
    });
    if (!key || !key.instance.enabled || key.instance.status !== 1) throw new UnauthorizedError("产品 API Key 无效");
    if (key.expiresAt && key.expiresAt <= new Date()) throw new UnauthorizedError("产品 API Key 已过期");
    const productCode = key.instance.entitlement.productCode;
    if (!isDeveloperProductCode(productCode)) throw new UnauthorizedError("产品 API Key 产品无效");
    const entitlement = await this.getActiveEntitlement(key.instance.entitlement.accountOwnerId, productCode);
    const config = await prisma.developerProductConfig.findUnique({ where: { productCode } });
    if (!config?.enabled) throw new ForbiddenError("产品当前未启用");
    if (key.subjectUser.status !== 1) throw new UnauthorizedError("RAM 主体已禁用");
    const ownerId = this.accountOwnerId(key.subjectUser);
    if (ownerId !== entitlement.accountOwnerId) throw new UnauthorizedError("RAM 主体不属于产品账号");
    const actions = this.readActions(key.actions);
    if (requiredActions.some((action) => !actions.includes(action)))
      throw new ForbiddenError("产品 API Key 未授权该动作");
    const permissions = await this.permissionService.getUserFullPermissions(key.subjectUserId);
    if (!permissions || requiredActions.some((action) => !permissions.effectivePermissions.includes(action)))
      throw new ForbiddenError("RAM 权限不足");
    await prisma.developerProductApiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date(), requestCount: { increment: 1 } },
    });
    return {
      keyId: key.id,
      instanceId: key.instanceId,
      backingProjectId: key.instance.backingProjectId,
      entitlementId: entitlement.id,
      productCode,
      subjectUserId: key.subjectUserId,
      accountOwnerId: ownerId,
      actions,
    };
  }

  async getUsage(entitlementId: string): Promise<DeveloperProductUsageDto> {
    const entitlement = await prisma.developerProductEntitlement.findUnique({ where: { id: entitlementId } });
    if (!entitlement || !isDeveloperProductCode(entitlement.productCode)) throw new NotFoundError("产品授权不存在");
    const config = await prisma.developerProductConfig.findUnique({ where: { productCode: entitlement.productCode } });
    const usageDate = new Date();
    usageDate.setHours(0, 0, 0, 0);
    const usage = await prisma.developerProductQuotaUsage.findUnique({
      where: { entitlementId_usageDate: { entitlementId, usageDate } },
    });
    const dailyFreeQuota = entitlement.dailyFreeQuota ?? config?.defaultDailyQuota ?? 0;
    const requestCount = usage?.requestCount ?? 0;
    return {
      entitlementId,
      productCode: entitlement.productCode,
      requestCount,
      dailyFreeQuota,
      remainingFree: Math.max(0, dailyFreeQuota - requestCount),
      overageEnabled: entitlement.overageEnabled,
    };
  }

  async getUsageForProduct(
    productCode: DeveloperProductCode,
    entitlementId: string,
  ): Promise<DeveloperProductUsageDto> {
    const usage = await this.getUsage(entitlementId);
    if (usage.productCode !== productCode) throw new NotFoundError("产品授权不存在");
    return usage;
  }

  async listCallLogs(productCode: DeveloperProductCode, entitlementId: string): Promise<DeveloperProductCallLogDto[]> {
    const entitlement = await prisma.developerProductEntitlement.findFirst({
      where: { id: entitlementId, productCode, status: 1 },
      select: { id: true },
    });
    if (!entitlement) throw new NotFoundError("产品授权不存在");
    const logs = await prisma.developerProductCallLog.findMany({
      where: { entitlementId },
      orderBy: { createTime: "desc" },
      take: 200,
    });
    return logs.map((log) => ({
      id: log.id,
      entitlementId: log.entitlementId,
      instanceId: log.instanceId ?? undefined,
      keyId: log.keyId ?? undefined,
      subjectUserId: log.subjectUserId ?? undefined,
      action: log.action,
      success: log.success,
      errorCode: log.errorCode ?? undefined,
      chargeAmount: Number(log.chargeAmount),
      createTime: log.createTime.toISOString(),
    }));
  }

  private async consumeQuota(context: ProductKeyContext): Promise<ProductQuotaReceipt> {
    const usageDate = new Date();
    usageDate.setHours(0, 0, 0, 0);
    return prisma.$transaction(async (tx) => {
      const entitlement = await tx.developerProductEntitlement.findUnique({ where: { id: context.entitlementId } });
      const config = await tx.developerProductConfig.findUnique({ where: { productCode: context.productCode } });
      if (!entitlement || !config) throw new NotFoundError("产品授权或配置不存在");
      const usage = await tx.developerProductQuotaUsage.upsert({
        where: { entitlementId_usageDate: { entitlementId: entitlement.id, usageDate } },
        create: { entitlementId: entitlement.id, usageDate, requestCount: 1 },
        update: { requestCount: { increment: 1 } },
      });
      const freeQuota = entitlement.dailyFreeQuota ?? config.defaultDailyQuota;
      if (usage.requestCount <= freeQuota)
        return {
          usageId: usage.id,
          entitlementId: entitlement.id,
          accountOwnerId: entitlement.accountOwnerId,
          chargeAmount: 0,
        };
      if (!entitlement.overageEnabled)
        throw new ForbiddenError("今日产品免费额度已用尽", CustomCode.DEVELOPER_QUOTA_EXCEEDED);
      const chargeAmount = Number(config.overagePrice);
      if (!chargeAmount)
        return {
          usageId: usage.id,
          entitlementId: entitlement.id,
          accountOwnerId: entitlement.accountOwnerId,
          chargeAmount: 0,
        };
      const account = await tx.balanceAccount.findUnique({ where: { userId: entitlement.accountOwnerId } });
      const balanceBefore = Number(account?.balance ?? 0);
      const charged = await tx.balanceAccount.updateMany({
        where: { userId: entitlement.accountOwnerId, status: 1, balance: { gte: new Decimal(chargeAmount) } },
        data: {
          balance: { decrement: new Decimal(chargeAmount) },
          totalUsed: { increment: new Decimal(chargeAmount) },
        },
      });
      if (!charged.count)
        throw new ForbiddenError("余额不足，无法执行产品超额调用", CustomCode.DEVELOPER_BALANCE_INSUFFICIENT);
      const balanceAfter = Math.round((balanceBefore - chargeAmount) * 1_000_000) / 1_000_000;
      await tx.balanceTransaction.create({
        data: {
          userId: entitlement.accountOwnerId,
          type: "developer_product_overage",
          amount: new Decimal(-chargeAmount),
          balanceBefore: new Decimal(balanceBefore),
          balanceAfter: new Decimal(balanceAfter),
          relatedId: usage.id,
          model: `product:${context.productCode}`,
          description: `产品 ${context.productCode} 超额调用`,
          fixedPrice: new Decimal(chargeAmount),
        },
      });
      return {
        usageId: usage.id,
        entitlementId: entitlement.id,
        accountOwnerId: entitlement.accountOwnerId,
        chargeAmount,
      };
    });
  }

  private async refundQuota(receipt: ProductQuotaReceipt): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.developerProductQuotaUsage.update({
        where: { id: receipt.usageId },
        data: { requestCount: { decrement: 1 } },
      });
      if (!receipt.chargeAmount) return;
      const account = await tx.balanceAccount.findUnique({ where: { userId: receipt.accountOwnerId } });
      if (!account) return;
      const balanceBefore = Number(account.balance);
      const updated = await tx.balanceAccount.update({
        where: { userId: receipt.accountOwnerId },
        data: {
          balance: { increment: new Decimal(receipt.chargeAmount) },
          totalUsed: { decrement: new Decimal(receipt.chargeAmount) },
        },
      });
      await tx.balanceTransaction.create({
        data: {
          userId: receipt.accountOwnerId,
          type: "developer_product_overage_refund",
          amount: new Decimal(receipt.chargeAmount),
          balanceBefore: new Decimal(balanceBefore),
          balanceAfter: updated.balance,
          relatedId: receipt.usageId,
          model: "product-refund",
          description: "产品调用失败退款",
          fixedPrice: new Decimal(receipt.chargeAmount),
        },
      });
    });
  }

  async executeMetered<T>(context: ProductKeyContext, action: string, callback: () => Promise<T>): Promise<T> {
    const receipt = await this.consumeQuota(context);
    try {
      const result = await callback();
      await prisma.developerProductCallLog.create({
        data: {
          entitlementId: context.entitlementId,
          instanceId: context.instanceId,
          keyId: context.keyId,
          subjectUserId: context.subjectUserId,
          action,
          success: true,
          chargeAmount: new Decimal(receipt.chargeAmount),
        },
      });
      return result;
    } catch (error) {
      await this.refundQuota(receipt).catch(() => {});
      await prisma.developerProductCallLog
        .create({
          data: {
            entitlementId: context.entitlementId,
            instanceId: context.instanceId,
            keyId: context.keyId,
            subjectUserId: context.subjectUserId,
            action,
            success: false,
            errorCode: error instanceof ForbiddenError ? error.code : undefined,
          },
        })
        .catch(() => {});
      throw error;
    }
  }

  async recordCall(context: ProductKeyContext, action: string, success: boolean): Promise<void> {
    await prisma.developerProductCallLog.create({
      data: {
        entitlementId: context.entitlementId,
        instanceId: context.instanceId,
        keyId: context.keyId,
        subjectUserId: context.subjectUserId,
        action,
        success,
      },
    });
  }
}

export const developerProductPlatformService = DeveloperProductPlatformService.getInstance();

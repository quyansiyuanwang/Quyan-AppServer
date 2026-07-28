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
import { toDatabaseDate, toLegacyDatabaseDate } from "@/util/database-date";
import type {
  CreateDeveloperProductApiKeyDto,
  CreateDeveloperProductInstanceDto,
  DeveloperProductSubjectDto,
  DeveloperProductApiKeyDto,
  DeveloperProductConfigDto,
  DeveloperProductCallLogDto,
  DeveloperProductAccountDto,
  DeveloperProductManagedAccountDto,
  DeveloperProductManagedAccountsDto,
  DeveloperProductInstanceDto,
  DeveloperProductUsageDto,
  UpdateDeveloperProductAccountDto,
  UpdateDeveloperProductInstanceDto,
  UpdateDeveloperProductConfigDto,
} from "@/api/dto/developer/product-platform.dto";

const PRODUCT_KEY_PREFIX = "dpk_";
const QUOTA_TRANSACTION_MAX_ATTEMPTS = 8;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const asIso = (value: Date | null | undefined) => value?.toISOString();

function isRetryableQuotaTransactionError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error.code === "P2002" || error.code === "P2034")
  );
}

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

type ProductMeteringContext = Omit<ProductKeyContext, "keyId" | "subjectUserId" | "actions"> & {
  keyId?: string;
  subjectUserId?: string;
  actions: Permission[];
};

type ProductQuotaReceipt = {
  usageId: string;
  entitlementId: string;
  accountOwnerId: string;
  chargeAmount: number;
};

type ProductAccountRecord = Prisma.DeveloperProductEntitlementGetPayload<{
  include: { accountOwner: { select: { username: true; displayName: true } } };
}>;

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
          create: { productCode, enabled: true, defaultDailyQuota: 0, defaultInstanceLimit: 1, retentionDays: 30 },
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

  private accountDto(accountProduct: ProductAccountRecord): DeveloperProductAccountDto {
    return {
      id: accountProduct.id,
      accountOwnerId: accountProduct.accountOwnerId,
      accountOwnerUsername: accountProduct.accountOwner?.username,
      accountOwnerDisplayName: accountProduct.accountOwner?.displayName ?? undefined,
      productCode: accountProduct.productCode as DeveloperProductCode,
      dailyFreeQuota: accountProduct.dailyFreeQuota ?? undefined,
      overageEnabled: accountProduct.overageEnabled,
      instanceLimit: accountProduct.instanceLimit,
      createTime: accountProduct.createTime.toISOString(),
      updateTime: accountProduct.updateTime.toISOString(),
    };
  }

  private instanceDto(instance: any): DeveloperProductInstanceDto {
    return {
      id: instance.id,
      productCode: instance.entitlement.productCode as DeveloperProductCode,
      accountProductId: instance.entitlementId,
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

  /**
   * Product records are account-scoped usage ledgers, not access grants.
   * Provisioning is deliberately lazy so a valid RAM permission is enough to
   * start using a product without a separate distribution workflow.
   */
  private async getAccountProduct(accountOwnerId: string, productCode: DeveloperProductCode): Promise<any> {
    await this.ensureConfigs();
    const config = await prisma.developerProductConfig.findUnique({ where: { productCode } });
    return prisma.developerProductEntitlement.upsert({
      where: { accountOwnerId_productCode: { accountOwnerId, productCode } },
      update: { status: 1 },
      create: {
        accountOwnerId,
        productCode,
        enabled: true,
        dailyFreeQuota: null,
        overageEnabled: false,
        instanceLimit: config?.defaultInstanceLimit ?? 1,
        startsAt: null,
        expiresAt: null,
        issuedByUserId: accountOwnerId,
      },
    });
  }

  private async assertProductAccess(actorUserId: string, productCode: DeveloperProductCode): Promise<any> {
    const permissions = await this.permissionService.getUserFullPermissions(actorUserId);
    if (
      !permissions ||
      !this.productPermissions(productCode).some((permission) => permissions.effectivePermissions.includes(permission))
    )
      throw new ForbiddenError("RAM 权限不足，无法访问该产品");
    const user = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, accountOwnerId: true },
    });
    if (!user) throw new UnauthorizedError("用户不存在");
    return user;
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
    return;
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

  async listAccounts(productCode?: DeveloperProductCode): Promise<DeveloperProductAccountDto[]> {
    const accountProducts = await prisma.developerProductEntitlement.findMany({
      where: productCode ? { productCode } : undefined,
      orderBy: { updateTime: "desc" },
      include: { accountOwner: { select: { username: true, displayName: true } } },
    });
    return accountProducts.map((accountProduct) => this.accountDto(accountProduct));
  }

  private async getPrimaryAccountUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, displayName: true, accountOwnerId: true, userType: true },
    });
    if (!user || user.userType !== "root" || (user.accountOwnerId && user.accountOwnerId !== user.id))
      throw new BadRequestError("只能管理主账号产品记录");
    return user;
  }

  private managedAccountDto(
    user: { id: string; username: string; displayName: string | null },
    account?: ProductAccountRecord,
  ): DeveloperProductManagedAccountDto {
    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName ?? undefined,
      account: account ? this.accountDto(account) : undefined,
    };
  }

  async listManagedAccounts(
    productCode: DeveloperProductCode,
    page = 1,
    pageSize = 20,
    keyword?: string,
  ): Promise<DeveloperProductManagedAccountsDto> {
    const normalizedKeyword = keyword?.trim();
    const where: Prisma.UserWhereInput = {
      userType: "root",
      ...(normalizedKeyword
        ? {
            OR: [
              { id: { contains: normalizedKeyword } },
              { username: { contains: normalizedKeyword } },
              { displayName: { contains: normalizedKeyword } },
            ],
          }
        : {}),
    };
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: { id: true, username: true, displayName: true },
        orderBy: [{ createTime: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.user.count({ where }),
    ]);
    const userIds = users.map((user) => user.id);
    const accounts = await prisma.developerProductEntitlement.findMany({
      where: { productCode, accountOwnerId: { in: userIds }, status: 1 },
      include: { accountOwner: { select: { username: true, displayName: true } } },
    });
    const accountsByOwnerId = new Map(accounts.map((account) => [account.accountOwnerId, account]));
    return {
      records: users.map((user) => this.managedAccountDto(user, accountsByOwnerId.get(user.id))),
      total,
      page,
      pageSize,
    };
  }

  async updateManagedAccount(
    actorUserId: string,
    productCode: DeveloperProductCode,
    userId: string,
    body: UpdateDeveloperProductAccountDto,
  ): Promise<DeveloperProductManagedAccountDto> {
    const user = await this.getPrimaryAccountUser(userId);
    await this.ensureConfigs();
    const config = await prisma.developerProductConfig.findUnique({ where: { productCode } });
    const account = await prisma.developerProductEntitlement.upsert({
      where: { accountOwnerId_productCode: { accountOwnerId: user.id, productCode } },
      create: {
        accountOwnerId: user.id,
        productCode,
        enabled: true,
        dailyFreeQuota: body.dailyFreeQuota,
        overageEnabled: body.overageEnabled,
        instanceLimit: body.instanceLimit,
        startsAt: null,
        expiresAt: null,
        issuedByUserId: actorUserId,
      },
      update: {
        status: 1,
        dailyFreeQuota: body.dailyFreeQuota,
        overageEnabled: body.overageEnabled,
        instanceLimit: body.instanceLimit,
      },
      include: { accountOwner: { select: { username: true, displayName: true } } },
    });
    if (!config) throw new NotFoundError("产品配置不存在");
    return this.managedAccountDto(user, account);
  }

  private async managedEntitlement(productCode: DeveloperProductCode, userId: string) {
    const user = await this.getPrimaryAccountUser(userId);
    const entitlement = await prisma.developerProductEntitlement.findFirst({
      where: { accountOwnerId: user.id, productCode, status: 1 },
    });
    if (!entitlement) throw new NotFoundError("该用户尚未启用产品运营记录");
    return entitlement;
  }

  async getManagedUsage(productCode: DeveloperProductCode, userId: string): Promise<DeveloperProductUsageDto> {
    const entitlement = await this.managedEntitlement(productCode, userId);
    return this.getUsageForProduct(productCode, entitlement.id);
  }

  async listManagedCallLogs(productCode: DeveloperProductCode, userId: string): Promise<DeveloperProductCallLogDto[]> {
    const entitlement = await this.managedEntitlement(productCode, userId);
    return this.listCallLogs(productCode, entitlement.id);
  }

  async listManagedInstances(
    productCode: DeveloperProductCode,
    userId: string,
  ): Promise<DeveloperProductInstanceDto[]> {
    const entitlement = await this.managedEntitlement(productCode, userId);
    const instances = await prisma.developerProductInstance.findMany({
      where: { entitlementId: entitlement.id, status: 1 },
      include: { entitlement: { select: { productCode: true } } },
      orderBy: { createTime: "desc" },
    });
    return instances.map((instance) => this.instanceDto(instance));
  }

  async listInstances(actorUserId: string, productCode: DeveloperProductCode): Promise<DeveloperProductInstanceDto[]> {
    const user = await this.assertProductAccess(actorUserId, productCode);
    return this.listInstancesForAccountOwner(this.accountOwnerId(user), productCode);
  }

  async listInstancesWithPermission(
    actorUserId: string,
    productCode: DeveloperProductCode,
    permission: Permission,
  ): Promise<DeveloperProductInstanceDto[]> {
    await this.assertProductPermission(actorUserId, productCode, permission);
    const user = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, accountOwnerId: true },
    });
    if (!user) throw new UnauthorizedError("用户不存在");
    return this.listInstancesForAccountOwner(this.accountOwnerId(user), productCode);
  }

  private async listInstancesForAccountOwner(
    accountOwnerId: string,
    productCode: DeveloperProductCode,
  ): Promise<DeveloperProductInstanceDto[]> {
    const entitlement = await this.getAccountProduct(accountOwnerId, productCode);
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
    const entitlement = await this.getAccountProduct(ownerId, productCode);
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

  private async getOwnedInstance(
    actorUserId: string,
    productCode: DeveloperProductCode,
    instanceId: string,
    requireEnabled: boolean,
  ): Promise<any> {
    await this.assertProductPermission(actorUserId, productCode, this.productPermissions(productCode).at(-1)!);
    const instance = await prisma.developerProductInstance.findFirst({
      where: {
        id: instanceId,
        status: 1,
        ...(requireEnabled ? { enabled: true } : {}),
        entitlement: { productCode, status: 1 },
      },
      include: { entitlement: { select: { accountOwnerId: true, productCode: true } } },
    });
    if (!instance) throw new NotFoundError("产品实例不存在");
    const user = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, accountOwnerId: true },
    });
    if (!user || instance.entitlement.accountOwnerId !== this.accountOwnerId(user))
      throw new NotFoundError("产品实例不存在");
    return instance;
  }

  async updateInstance(
    actorUserId: string,
    productCode: DeveloperProductCode,
    instanceId: string,
    body: UpdateDeveloperProductInstanceDto,
  ): Promise<DeveloperProductInstanceDto> {
    await this.getOwnedInstance(actorUserId, productCode, instanceId, false);
    const updated = await prisma.developerProductInstance.updateMany({
      where: { id: instanceId, status: 1 },
      data: { enabled: body.enabled },
    });
    if (!updated.count) throw new NotFoundError("产品实例不存在");
    const instance = await this.getOwnedInstance(actorUserId, productCode, instanceId, false);
    return this.instanceDto(instance);
  }

  async deleteInstance(actorUserId: string, productCode: DeveloperProductCode, instanceId: string): Promise<void> {
    const instance = await this.getOwnedInstance(actorUserId, productCode, instanceId, false);
    await prisma.$transaction(async (tx) => {
      await tx.developerProductApiKey.updateMany({
        where: { instanceId: instance.id, status: 1 },
        data: { status: -1 },
      });
      const deleted = await tx.developerProject.deleteMany({ where: { id: instance.backingProjectId } });
      if (!deleted.count) throw new NotFoundError("产品实例不存在");
    });
  }

  private async getAuthorizedInstance(
    actorUserId: string,
    productCode: DeveloperProductCode,
    instanceId: string,
    permission: Permission,
  ): Promise<any> {
    await this.assertProductPermission(actorUserId, productCode, permission);
    const instance = await prisma.developerProductInstance.findFirst({
      where: { id: instanceId, status: 1, entitlement: { productCode, status: 1 } },
      include: { entitlement: true },
    });
    if (!instance) throw new NotFoundError("产品实例不存在");
    const user = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, accountOwnerId: true },
    });
    if (!user || instance.entitlement.accountOwnerId !== this.accountOwnerId(user))
      throw new NotFoundError("产品实例不存在");
    if (!instance.enabled) throw new ForbiddenError("产品实例已停用", CustomCode.DEVELOPER_PRODUCT_INSTANCE_DISABLED);
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
    await this.getOwnedInstance(actorUserId, productCode, instanceId, false);
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
    const isAccountOwner = user.id === accountOwnerId;
    const subjects = await prisma.user.findMany({
      where: isAccountOwner
        ? { status: 1, OR: [{ id: accountOwnerId }, { accountOwnerId }] }
        : { id: user.id, status: 1 },
      select: { id: true, username: true, displayName: true },
      orderBy: { createTime: "asc" },
    });
    const allowed = this.productPermissions(productCode);
    const subjectDtos = await Promise.all(
      subjects.map(async (subject) => {
        const permissions = await this.permissionService.getUserFullPermissions(subject.id);
        return {
          id: subject.id,
          username: subject.username,
          displayName: subject.displayName ?? undefined,
          allowedActions: allowed.filter((action) => Boolean(permissions?.effectivePermissions.includes(action))),
        };
      }),
    );
    return subjectDtos.filter((subject) => subject.allowedActions.length > 0);
  }

  async createKey(
    actorUserId: string,
    productCode: DeveloperProductCode,
    instanceId: string,
    body: CreateDeveloperProductApiKeyDto,
  ): Promise<DeveloperProductApiKeyDto> {
    const instance = await this.getOwnedInstance(actorUserId, productCode, instanceId, false);
    const actor = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, accountOwnerId: true },
    });
    if (!actor) throw new UnauthorizedError("用户不存在");
    const accountOwnerId = this.accountOwnerId(actor);
    if (actor.id !== accountOwnerId && body.subjectUserId !== actor.id)
      throw new ForbiddenError("RAM 用户只能创建绑定自身的产品 API Key");
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
    await this.getOwnedInstance(actorUserId, productCode, instanceId, false);
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
    if (!key || key.instance.status !== 1) throw new UnauthorizedError("产品 API Key 无效");
    if (!key.instance.enabled)
      throw new ForbiddenError("产品实例已停用", CustomCode.DEVELOPER_PRODUCT_INSTANCE_DISABLED);
    if (key.expiresAt && key.expiresAt <= new Date()) throw new UnauthorizedError("产品 API Key 已过期");
    const productCode = key.instance.entitlement.productCode;
    if (!isDeveloperProductCode(productCode)) throw new UnauthorizedError("产品 API Key 产品无效");
    const config = await prisma.developerProductConfig.findUnique({ where: { productCode } });
    if (!config?.enabled) throw new ForbiddenError("产品当前未启用");
    if (key.subjectUser.status !== 1) throw new UnauthorizedError("RAM 主体已禁用");
    const ownerId = this.accountOwnerId(key.subjectUser);
    if (ownerId !== key.instance.entitlement.accountOwnerId) throw new UnauthorizedError("RAM 主体不属于产品账号");
    const actions = this.readActions(key.actions);
    if (requiredActions.some((action) => !actions.includes(action)))
      throw new ForbiddenError("产品 API Key 未授权该动作");
    const permissions = await this.permissionService.getUserFullPermissions(key.subjectUserId);
    if (!permissions || requiredActions.some((action) => !permissions.effectivePermissions.includes(action)))
      throw new ForbiddenError("RAM 权限不足");
    await prisma.developerProductApiKey.updateMany({
      where: { id: key.id, status: 1 },
      data: { lastUsedAt: new Date(), requestCount: { increment: 1 } },
    });
    return {
      keyId: key.id,
      instanceId: key.instanceId,
      backingProjectId: key.instance.backingProjectId,
      entitlementId: key.instance.entitlementId,
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
    const usageDate = toDatabaseDate();
    let usage = await prisma.developerProductQuotaUsage.findUnique({
      where: { entitlementId_usageDate: { entitlementId, usageDate } },
    });
    const legacyUsageDate = toLegacyDatabaseDate();
    if (!usage && legacyUsageDate.getTime() !== usageDate.getTime())
      usage = await prisma.developerProductQuotaUsage.findUnique({
        where: { entitlementId_usageDate: { entitlementId, usageDate: legacyUsageDate } },
      });
    const dailyFreeQuota = entitlement.dailyFreeQuota ?? config?.defaultDailyQuota ?? 0;
    const requestCount = usage?.requestCount ?? 0;
    const unlimited = Number(config?.overagePrice ?? 0) <= 0;
    return {
      entitlementId,
      productCode: entitlement.productCode,
      requestCount,
      dailyFreeQuota,
      remainingFree: unlimited ? 0 : Math.max(0, dailyFreeQuota - requestCount),
      unlimited,
      overageEnabled: entitlement.overageEnabled,
    };
  }

  async getUsageForActor(actorUserId: string, productCode: DeveloperProductCode): Promise<DeveloperProductUsageDto> {
    const user = await this.assertProductAccess(actorUserId, productCode);
    const accountProduct = await this.getAccountProduct(this.accountOwnerId(user), productCode);
    return this.getUsage(accountProduct.id);
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

  async listCallLogsForActor(
    actorUserId: string,
    productCode: DeveloperProductCode,
  ): Promise<DeveloperProductCallLogDto[]> {
    const user = await this.assertProductAccess(actorUserId, productCode);
    const accountProduct = await this.getAccountProduct(this.accountOwnerId(user), productCode);
    return this.listCallLogs(productCode, accountProduct.id);
  }

  private async consumeQuota(context: ProductMeteringContext): Promise<ProductQuotaReceipt> {
    const usageDate = toDatabaseDate();
    const legacyUsageDate = toLegacyDatabaseDate();
    for (let attempt = 0; attempt < QUOTA_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await prisma.$transaction(async (tx) => {
          const entitlement = await tx.developerProductEntitlement.findUnique({ where: { id: context.entitlementId } });
          const config = await tx.developerProductConfig.findUnique({ where: { productCode: context.productCode } });
          if (!entitlement || !config) throw new NotFoundError("产品授权或配置不存在");
          const usage = await this.incrementQuotaUsage(tx, entitlement.id, usageDate, legacyUsageDate);
          const chargeAmount = Number(config.overagePrice);
          // A zero price deliberately represents a free, unlimited product. We still
          // retain usage for capacity planning and audit, but never block on quota.
          if (chargeAmount <= 0)
            return {
              usageId: usage.id,
              entitlementId: entitlement.id,
              accountOwnerId: entitlement.accountOwnerId,
              chargeAmount: 0,
            };
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
      } catch (error) {
        // A first request can race on the daily row across PM2 workers. MySQL
        // can also abort a competing transaction with P2034 (deadlock/write
        // conflict); neither transaction has committed partial quota changes.
        if (attempt < QUOTA_TRANSACTION_MAX_ATTEMPTS - 1 && isRetryableQuotaTransactionError(error)) {
          if (error.code === "P2034") await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 10));
          continue;
        }
        throw error;
      }
    }
    throw new Error("产品配额扣减重试意外结束");
  }

  private async incrementQuotaUsage(
    tx: Prisma.TransactionClient,
    entitlementId: string,
    usageDate: Date,
    legacyUsageDate: Date,
  ): Promise<{ id: string; requestCount: number }> {
    const where = { entitlementId_usageDate: { entitlementId, usageDate } };
    const incremented = await tx.developerProductQuotaUsage.updateMany({
      where: { entitlementId, usageDate },
      data: { requestCount: { increment: 1 } },
    });

    if (incremented.count) {
      const usage = await tx.developerProductQuotaUsage.findUnique({ where });
      if (usage) return usage;
    }

    if (legacyUsageDate.getTime() !== usageDate.getTime()) {
      const migrated = await tx.developerProductQuotaUsage.updateMany({
        where: { entitlementId, usageDate: legacyUsageDate },
        data: { usageDate, requestCount: { increment: 1 } },
      });
      if (migrated.count) {
        const usage = await tx.developerProductQuotaUsage.findUnique({ where });
        if (usage) return usage;
      }
    }

    return tx.developerProductQuotaUsage.create({
      data: { entitlementId, usageDate, requestCount: 1 },
    });
  }

  private async refundQuota(receipt: ProductQuotaReceipt): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.developerProductQuotaUsage.updateMany({
        where: { id: receipt.usageId },
        data: { requestCount: { decrement: 1 } },
      });
      if (!receipt.chargeAmount) return;
      const account = await tx.balanceAccount.findUnique({ where: { userId: receipt.accountOwnerId } });
      if (!account) return;
      const balanceBefore = Number(account.balance);
      const updated = await tx.balanceAccount.updateMany({
        where: { userId: receipt.accountOwnerId },
        data: {
          balance: { increment: new Decimal(receipt.chargeAmount) },
          totalUsed: { decrement: new Decimal(receipt.chargeAmount) },
        },
      });
      if (!updated.count) return;
      const accountAfter = await tx.balanceAccount.findUnique({ where: { userId: receipt.accountOwnerId } });
      if (!accountAfter) return;
      await tx.balanceTransaction.create({
        data: {
          userId: receipt.accountOwnerId,
          type: "developer_product_overage_refund",
          amount: new Decimal(receipt.chargeAmount),
          balanceBefore: new Decimal(balanceBefore),
          balanceAfter: accountAfter.balance,
          relatedId: receipt.usageId,
          model: "product-refund",
          description: "产品调用失败退款",
          fixedPrice: new Decimal(receipt.chargeAmount),
        },
      });
    });
  }

  async executeMetered<T>(context: ProductMeteringContext, action: string, callback: () => Promise<T>): Promise<T> {
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

  private async getInstanceMeteringContext(
    productCode: DeveloperProductCode,
    where: { id?: string; backingProjectId?: string },
  ): Promise<ProductMeteringContext | undefined> {
    const instance = await prisma.developerProductInstance.findFirst({
      where: {
        ...where,
        status: 1,
        enabled: true,
        entitlement: { productCode, status: 1, enabled: true },
      },
      include: { entitlement: true },
    });
    if (!instance) return undefined;
    const config = await prisma.developerProductConfig.findUnique({ where: { productCode } });
    if (!config?.enabled) throw new ForbiddenError("产品当前未启用");
    return {
      instanceId: instance.id,
      backingProjectId: instance.backingProjectId,
      entitlementId: instance.entitlementId,
      productCode,
      accountOwnerId: instance.entitlement.accountOwnerId,
      actions: [],
    };
  }

  async executeMeteredForInstance<T>(
    instanceId: string,
    productCode: DeveloperProductCode,
    action: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    const context = await this.getInstanceMeteringContext(productCode, { id: instanceId });
    if (!context) throw new NotFoundError("产品实例不存在");
    return this.executeMetered(context, action, callback);
  }

  /** Legacy projects do not participate in product billing. */
  async executeMeteredForBackingProject<T>(
    backingProjectId: string,
    productCode: DeveloperProductCode,
    action: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    const context = await this.getInstanceMeteringContext(productCode, { backingProjectId });
    return context ? this.executeMetered(context, action, callback) : callback();
  }

  async recordCall(context: ProductMeteringContext, action: string, success: boolean): Promise<void> {
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

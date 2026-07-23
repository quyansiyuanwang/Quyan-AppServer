import axios from "axios";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { isIP } from "net";
import { lookup } from "dns/promises";
import nodemailer from "nodemailer";
import type { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/config/database";
import { CONFIG_KEYS } from "@/constant/config-keys";
import { ConfigService } from "@/services/system/config.service";
import { NotificationService } from "@/services/notification/notification.service";
import { NotificationEvent } from "@/constant/notification-event";
import { BadRequestError, ForbiddenError, NotFoundError, TooManyRequestsError, UnauthorizedError } from "@/util/errors";
import { CustomCode } from "@/constant/custom-code";
import type {
  CreateDeveloperApiKeyDto,
  CreateDeveloperProjectDto,
  CreateDeveloperPushChannelDto,
  CreateDeveloperStatusMonitorDto,
  CreateShortLinkDto,
  DeveloperApiKeyDto,
  DeveloperApiKeyScope,
  DeveloperKvValueDto,
  DeveloperProjectDto,
  DeveloperQuotaSummaryDto,
  DeveloperQuotaOverrideDto,
  DeveloperPushChannelDto,
  DeveloperPushDeliveryDto,
  DeveloperSecretDto,
  DeveloperShortLinkDto,
  DeveloperShortLinkStatsDto,
  DeveloperStatusMonitorDto,
  SendDeveloperPushDto,
  SendDeveloperVerificationDto,
  SetKvValueDto,
  UpdateShortLinkDto,
  UpdateDeveloperStatusMonitorDto,
  UpdateDeveloperPushChannelDto,
  UpsertDeveloperSecretDto,
  UpsertDeveloperQuotaOverrideDto,
  VerifyDeveloperCodeDto,
} from "@/api/dto/developer/developer.dto";

const KEY_PREFIX = "dk_";
const MAX_KV_ENTRIES = 1_000;
const MAX_KV_VALUE_BYTES = 64 * 1024;
const MAX_OUTBOUND_RESPONSE_BYTES = 1_024 * 1_024;
const PROJECT_KEY_SCOPES = new Set<DeveloperApiKeyScope>([
  "kv:read",
  "kv:write",
  "verification:send",
  "verification:verify",
  "ip:lookup",
  "push:send",
]);
const QUOTA_SERVICES = ["verification", "ip", "push"] as const;
type QuotaService = (typeof QUOTA_SERVICES)[number];
type QuotaReceipt = {
  projectId: string;
  service: QuotaService;
  usageId: string;
  userId: string;
  chargeAmount: number;
};

type ProjectKeyRecord = Awaited<ReturnType<typeof prisma.developerProjectApiKey.findFirst>> & {
  project: { userId: string };
};

const asIso = (value: Date | null | undefined): string | undefined => value?.toISOString();
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

function isPrivateAddress(address: string): boolean {
  if (address === "::1" || address === "0.0.0.0" || address === "::") return true;
  if (address.startsWith("127.") || address.startsWith("10.") || address.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) return true;
  const normalized = address.toLowerCase();
  return (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("::ffff:127.")
  );
}

async function assertSafeOutboundUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestError("URL 无效");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new BadRequestError("仅允许 HTTP(S) URL");
  if (url.username || url.password) throw new BadRequestError("URL 不允许包含凭据");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const address = isIP(host) ? host : (await lookup(host, { family: 0 })).address;
  if (isPrivateAddress(address)) throw new ForbiddenError("不允许访问内网地址");
  return url;
}

export class DeveloperProjectRepository {
  private static instance: DeveloperProjectRepository;
  private readonly configService = ConfigService.getInstance();
  private readonly ipLocationCache = new Map<string, { expiresAt: number; value: Record<string, unknown> }>();

  static getInstance(): DeveloperProjectRepository {
    if (!this.instance) this.instance = new DeveloperProjectRepository();
    return this.instance;
  }

  async runWithSchedulerLock<T>(callback: () => Promise<T>): Promise<T | undefined> {
    const lockRows = await prisma.$queryRaw<Array<{ acquired: number }>>`SELECT GET_LOCK(${"appserver:developer-monitor-scheduler"}, 0) AS acquired`;
    if (lockRows[0]?.acquired !== 1) return undefined;
    try {
      return await callback();
    } finally {
      await prisma.$queryRaw`SELECT RELEASE_LOCK(${"appserver:developer-monitor-scheduler"})`;
    }
  }

  private toProjectDto(project: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    dailyFreeQuota: number;
    overageEnabled: boolean;
    statusPagePublished: boolean;
    createTime: Date;
    updateTime: Date;
  }): DeveloperProjectDto {
    return {
      ...project,
      description: project.description ?? undefined,
      createTime: project.createTime.toISOString(),
      updateTime: project.updateTime.toISOString(),
    };
  }

  private toApiKeyDto(
    key: {
      id: string;
      name: string;
      keyPrefix: string;
      scopes: unknown;
      expiresAt: Date | null;
      lastUsedAt: Date | null;
      requestCount: number;
    },
    rawKey?: string,
  ): DeveloperApiKeyDto {
    return {
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      scopes: this.readScopes(key.scopes),
      expiresAt: asIso(key.expiresAt),
      lastUsedAt: asIso(key.lastUsedAt),
      requestCount: key.requestCount,
      ...(rawKey ? { key: rawKey } : {}),
    };
  }

  private readScopes(value: unknown): DeveloperApiKeyScope[] {
    return Array.isArray(value)
      ? value.filter(
          (scope): scope is DeveloperApiKeyScope =>
            typeof scope === "string" && PROJECT_KEY_SCOPES.has(scope as DeveloperApiKeyScope),
        )
      : [];
  }

  private async assertProjectOwner(projectId: string, userId: string) {
    const project = await prisma.developerProject.findFirst({ where: { id: projectId, userId, status: 1 } });
    if (!project) throw new NotFoundError("项目不存在");
    return project;
  }

  async createProject(userId: string, body: CreateDeveloperProjectDto): Promise<DeveloperProjectDto> {
    const project = await prisma.developerProject.create({
      data: {
        userId,
        name: body.name.trim(),
        slug: body.slug.trim().toLowerCase(),
        description: body.description?.trim(),
      },
    });
    return this.toProjectDto(project);
  }

  async listProjects(userId: string): Promise<DeveloperProjectDto[]> {
    const projects = await prisma.developerProject.findMany({
      where: { userId, status: 1 },
      orderBy: { createTime: "desc" },
    });
    return projects.map((project) => this.toProjectDto(project));
  }

  async updateStatusPage(
    projectId: string,
    userId: string,
    body: { published: boolean },
  ): Promise<DeveloperProjectDto> {
    await this.assertProjectOwner(projectId, userId);
    const project = await prisma.developerProject.update({
      where: { id: projectId },
      data: { statusPagePublished: body.published },
    });
    return this.toProjectDto(project);
  }

  async getQuotaSummary(projectId: string, userId: string): Promise<DeveloperQuotaSummaryDto> {
    const project = await this.assertProjectOwner(projectId, userId);
    const usageDate = new Date();
    usageDate.setHours(0, 0, 0, 0);
    return prisma.$transaction(async (tx) => {
      const records = await tx.developerQuotaUsage.findMany({ where: { projectId, usageDate } });
      const counts = new Map(records.map((record) => [record.service, record.requestCount]));
      const usages = await Promise.all(
        QUOTA_SERVICES.map(async (service) => {
          const requestCount = counts.get(service) ?? 0;
          const dailyFreeQuota = await this.resolveDailyFreeQuota(tx, project, service);
          return {
            service,
            requestCount,
            dailyFreeQuota,
            remainingFree: Math.max(0, dailyFreeQuota - requestCount),
          };
        }),
      );
      return { dailyFreeQuota: project.dailyFreeQuota, overageEnabled: project.overageEnabled, usages };
    });
  }

  private async resolveDailyFreeQuota(
    tx: Prisma.TransactionClient,
    project: { id: string; userId: string; dailyFreeQuota: number },
    service: QuotaService,
  ): Promise<number> {
    const projectOverride = await tx.developerQuotaOverride.findFirst({
      where: {
        status: 1,
        subjectType: "project",
        subjectId: project.id,
        service: { in: [service, "*"] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: [{ service: "desc" }, { updateTime: "desc" }],
    });
    if (projectOverride) return projectOverride.dailyFreeQuota;
    const userOverride = await tx.developerQuotaOverride.findFirst({
      where: {
        status: 1,
        subjectType: "user",
        subjectId: project.userId,
        service: { in: [service, "*"] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: [{ service: "desc" }, { updateTime: "desc" }],
    });
    return userOverride?.dailyFreeQuota ?? project.dailyFreeQuota;
  }

  private toQuotaOverrideDto(override: {
    id: string;
    subjectType: string;
    subjectId: string;
    service: string;
    dailyFreeQuota: number;
    expiresAt: Date | null;
    createTime: Date;
    updateTime: Date;
  }): DeveloperQuotaOverrideDto {
    return {
      id: override.id,
      subjectType: override.subjectType as DeveloperQuotaOverrideDto["subjectType"],
      subjectId: override.subjectId,
      service: override.service === "*" ? undefined : (override.service as DeveloperQuotaOverrideDto["service"]),
      dailyFreeQuota: override.dailyFreeQuota,
      expiresAt: asIso(override.expiresAt),
      createTime: override.createTime.toISOString(),
      updateTime: override.updateTime.toISOString(),
    };
  }

  async listQuotaOverrides(): Promise<DeveloperQuotaOverrideDto[]> {
    const overrides = await prisma.developerQuotaOverride.findMany({
      where: { status: 1 },
      orderBy: { updateTime: "desc" },
    });
    return overrides.map((override) => this.toQuotaOverrideDto(override));
  }

  async upsertQuotaOverride(
    body: UpsertDeveloperQuotaOverrideDto,
    actorUserId: string,
  ): Promise<DeveloperQuotaOverrideDto> {
    if (body.subjectType === "project") {
      const project = await prisma.developerProject.findFirst({ where: { id: body.subjectId, status: 1 } });
      if (!project) throw new NotFoundError("项目不存在");
    } else {
      const user = await prisma.user.findFirst({ where: { id: body.subjectId, status: 1 } });
      if (!user) throw new NotFoundError("用户不存在");
    }
    const service = body.service ?? "*";
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) throw new BadRequestError("过期时间必须晚于当前时间");
    const override = await prisma.developerQuotaOverride.upsert({
      where: { subjectType_subjectId_service: { subjectType: body.subjectType, subjectId: body.subjectId, service } },
      create: {
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        service,
        dailyFreeQuota: body.dailyFreeQuota,
        expiresAt,
        createdByUserId: actorUserId,
      },
      update: { dailyFreeQuota: body.dailyFreeQuota, expiresAt, status: 1, createdByUserId: actorUserId },
    });
    return this.toQuotaOverrideDto(override);
  }

  async deleteQuotaOverride(id: string): Promise<void> {
    const result = await prisma.developerQuotaOverride.updateMany({ where: { id, status: 1 }, data: { status: -1 } });
    if (!result.count) throw new NotFoundError("额度覆盖不存在");
  }

  async createProjectApiKey(
    projectId: string,
    userId: string,
    body: CreateDeveloperApiKeyDto,
  ): Promise<DeveloperApiKeyDto> {
    await this.assertProjectOwner(projectId, userId);
    const rawKey = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;
    if (expiresAt && expiresAt.getTime() <= Date.now()) throw new BadRequestError("过期时间必须晚于当前时间");
    const key = await prisma.developerProjectApiKey.create({
      data: {
        projectId,
        name: body.name.trim(),
        keyHash: hash(rawKey),
        keyPrefix: rawKey.slice(0, 12),
        scopes: body.scopes,
        expiresAt,
      },
    });
    return this.toApiKeyDto(key, rawKey);
  }

  async listProjectApiKeys(projectId: string, userId: string): Promise<DeveloperApiKeyDto[]> {
    await this.assertProjectOwner(projectId, userId);
    const keys = await prisma.developerProjectApiKey.findMany({
      where: { projectId },
      orderBy: { createTime: "desc" },
    });
    return keys.map((key) => this.toApiKeyDto(key));
  }

  async revokeProjectApiKey(projectId: string, keyId: string, userId: string): Promise<void> {
    await this.assertProjectOwner(projectId, userId);
    const result = await prisma.developerProjectApiKey.updateMany({
      where: { id: keyId, projectId },
      data: { status: 0 },
    });
    if (!result.count) throw new NotFoundError("项目 API Key 不存在");
  }

  async authenticateProjectKey(rawKey: string, requiredScopes: string[]): Promise<NonNullable<ProjectKeyRecord>> {
    const key = await prisma.developerProjectApiKey.findFirst({
      where: { keyHash: hash(rawKey), status: 1, project: { status: 1 } },
      include: { project: { select: { userId: true } } },
    });
    if (!key || (key.expiresAt && key.expiresAt.getTime() <= Date.now()))
      throw new UnauthorizedError("项目 API Key 无效或已过期");
    const scopes = this.readScopes(key.scopes);
    const missing = requiredScopes.filter((scope) => !scopes.includes(scope as DeveloperApiKeyScope));
    if (missing.length) throw new ForbiddenError(`项目 API Key 缺少权限: ${missing.join(", ")}`);
    await prisma.developerProjectApiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date(), requestCount: { increment: 1 } },
    });
    return key as NonNullable<ProjectKeyRecord>;
  }

  private async getOveragePrice(service: QuotaService): Promise<number> {
    const configKey =
      service === "verification"
        ? CONFIG_KEYS.DEVELOPER.VERIFICATION_OVERAGE_PRICE
        : service === "ip"
          ? CONFIG_KEYS.DEVELOPER.IP_OVERAGE_PRICE
          : CONFIG_KEYS.DEVELOPER.PUSH_OVERAGE_PRICE;
    const value = Number(await this.configService.get(configKey));
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.round(value * 10_000) / 10_000;
  }

  private async consumeQuota(projectId: string, service: QuotaService): Promise<QuotaReceipt> {
    const usageDate = new Date();
    usageDate.setHours(0, 0, 0, 0);
    const overagePrice = await this.getOveragePrice(service);
    return prisma.$transaction(async (tx) => {
      const project = await tx.developerProject.findUnique({
        where: { id: projectId },
        select: { id: true, userId: true, dailyFreeQuota: true, overageEnabled: true },
      });
      if (!project) throw new NotFoundError("项目不存在");
      const dailyFreeQuota = await this.resolveDailyFreeQuota(tx, project, service);
      const usage = await tx.developerQuotaUsage.upsert({
        where: { projectId_service_usageDate: { projectId, service, usageDate } },
        create: { projectId, service, usageDate, requestCount: 1 },
        update: { requestCount: { increment: 1 } },
      });
      if (usage.requestCount > dailyFreeQuota && !project.overageEnabled)
        throw new ForbiddenError("今日免费额度已用尽", CustomCode.DEVELOPER_QUOTA_EXCEEDED);
      let chargeAmount = 0;
      if (usage.requestCount > dailyFreeQuota && overagePrice > 0) {
        const account = await tx.balanceAccount.findUnique({ where: { userId: project.userId } });
        const balanceBefore = Number(account?.balance ?? 0);
        const charged = await tx.balanceAccount.updateMany({
          where: { userId: project.userId, status: 1, balance: { gte: new Decimal(overagePrice) } },
          data: { balance: { decrement: new Decimal(overagePrice) }, totalUsed: { increment: new Decimal(overagePrice) } },
        });
        if (!charged.count)
          throw new ForbiddenError("余额不足，无法执行超额调用", CustomCode.DEVELOPER_BALANCE_INSUFFICIENT);
        const balanceAfter = Math.round((balanceBefore - overagePrice) * 10_000) / 10_000;
        await tx.balanceTransaction.create({
          data: {
            userId: project.userId,
            type: "developer_overage",
            amount: new Decimal(-overagePrice),
            balanceBefore: new Decimal(balanceBefore),
            balanceAfter: new Decimal(balanceAfter),
            relatedId: usage.id,
            model: `developer:${service}`,
            description: `开发者服务 ${service} 超额调用`,
            fixedPrice: new Decimal(overagePrice),
          },
        });
        chargeAmount = overagePrice;
      }
      return { projectId, service, usageId: usage.id, userId: project.userId, chargeAmount };
    });
  }

  private async refundQuota(receipt: QuotaReceipt): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.developerQuotaUsage.update({
        where: { id: receipt.usageId },
        data: { requestCount: { decrement: 1 } },
      });
      if (!receipt.chargeAmount) return;
      const account = await tx.balanceAccount.findUnique({ where: { userId: receipt.userId } });
      if (!account) return;
      const balanceBefore = Number(account.balance);
      const updated = await tx.balanceAccount.update({
        where: { userId: receipt.userId },
        data: {
          balance: { increment: new Decimal(receipt.chargeAmount) },
          totalUsed: { decrement: new Decimal(receipt.chargeAmount) },
        },
      });
      await tx.balanceTransaction.create({
        data: {
          userId: receipt.userId,
          type: "developer_overage_refund",
          amount: new Decimal(receipt.chargeAmount),
          balanceBefore: new Decimal(balanceBefore),
          balanceAfter: updated.balance,
          relatedId: receipt.usageId,
          model: `developer:${receipt.service}`,
          description: `开发者服务 ${receipt.service} 调用失败退款`,
          fixedPrice: new Decimal(receipt.chargeAmount),
        },
      });
    });
  }

  async getKv(projectId: string, key: string): Promise<DeveloperKvValueDto> {
    const item = await prisma.developerKvEntry.findFirst({ where: { projectId, key, status: 1 } });
    if (!item || (item.expiresAt && item.expiresAt.getTime() <= Date.now())) {
      if (item) await prisma.developerKvEntry.delete({ where: { id: item.id } });
      throw new NotFoundError("KV 键不存在");
    }
    return {
      key: item.key,
      value: item.value,
      version: item.version,
      expiresAt: asIso(item.expiresAt),
      updateTime: item.updateTime.toISOString(),
    };
  }

  async listKv(projectId: string): Promise<Array<Omit<DeveloperKvValueDto, "value">>> {
    await prisma.developerKvEntry.deleteMany({ where: { projectId, expiresAt: { lte: new Date() } } });
    const items = await prisma.developerKvEntry.findMany({
      where: { projectId, status: 1 },
      select: { key: true, version: true, expiresAt: true, updateTime: true },
      orderBy: { updateTime: "desc" },
    });
    return items.map((item) => ({
      key: item.key,
      version: item.version,
      expiresAt: asIso(item.expiresAt),
      updateTime: item.updateTime.toISOString(),
    }));
  }

  async setKv(projectId: string, key: string, body: SetKvValueDto): Promise<DeveloperKvValueDto> {
    const serialized = JSON.stringify(body.value);
    if (Buffer.byteLength(serialized) > MAX_KV_VALUE_BYTES) throw new BadRequestError("KV 值超过 64KB 限制");
    const existing = await prisma.developerKvEntry.findUnique({ where: { projectId_key: { projectId, key } } });
    if (!existing) {
      const count = await prisma.developerKvEntry.count({ where: { projectId, status: 1 } });
      if (count >= MAX_KV_ENTRIES) throw new ForbiddenError("项目 KV 条目数已达上限");
    }
    const expiresAt = body.ttlSeconds ? new Date(Date.now() + body.ttlSeconds * 1000) : null;
    const item = await prisma.developerKvEntry.upsert({
      where: { projectId_key: { projectId, key } },
      create: { projectId, key, value: body.value as any, expiresAt },
      update: { value: body.value as any, expiresAt, version: { increment: 1 }, status: 1 },
    });
    return {
      key: item.key,
      value: item.value,
      version: item.version,
      expiresAt: asIso(item.expiresAt),
      updateTime: item.updateTime.toISOString(),
    };
  }

  async deleteKv(projectId: string, key: string): Promise<void> {
    const result = await prisma.developerKvEntry.deleteMany({ where: { projectId, key } });
    if (!result.count) throw new NotFoundError("KV 键不存在");
  }

  async getProjectKv(projectId: string, userId: string, key: string): Promise<DeveloperKvValueDto> {
    await this.assertProjectOwner(projectId, userId);
    return this.getKv(projectId, key);
  }

  async listProjectKv(projectId: string, userId: string): Promise<Array<Omit<DeveloperKvValueDto, "value">>> {
    await this.assertProjectOwner(projectId, userId);
    return this.listKv(projectId);
  }

  async setProjectKv(
    projectId: string,
    userId: string,
    key: string,
    body: SetKvValueDto,
  ): Promise<DeveloperKvValueDto> {
    await this.assertProjectOwner(projectId, userId);
    return this.setKv(projectId, key, body);
  }

  async deleteProjectKv(projectId: string, userId: string, key: string): Promise<void> {
    await this.assertProjectOwner(projectId, userId);
    await this.deleteKv(projectId, key);
  }

  private shortLinkDto(link: {
    id: string;
    code: string;
    targetUrl: string;
    enabled: boolean;
    expiresAt: Date | null;
    clickCount: number;
  }): DeveloperShortLinkDto {
    return {
      id: link.id,
      code: link.code,
      targetUrl: link.targetUrl,
      enabled: link.enabled,
      expiresAt: asIso(link.expiresAt),
      clickCount: link.clickCount,
      publicUrl: `/s/${link.code}`,
    };
  }

  async createShortLink(projectId: string, userId: string, body: CreateShortLinkDto): Promise<DeveloperShortLinkDto> {
    await this.assertProjectOwner(projectId, userId);
    const target = await assertSafeOutboundUrl(body.targetUrl);
    const code = body.code?.trim().toLowerCase() || randomBytes(6).toString("base64url").toLowerCase();
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;
    const link = await prisma.developerShortLink.create({
      data: { projectId, code, targetUrl: target.toString(), expiresAt },
    });
    return this.shortLinkDto(link);
  }

  async listShortLinks(projectId: string, userId: string): Promise<DeveloperShortLinkDto[]> {
    await this.assertProjectOwner(projectId, userId);
    const links = await prisma.developerShortLink.findMany({ where: { projectId }, orderBy: { createTime: "desc" } });
    return links.map((link) => this.shortLinkDto(link));
  }

  async updateShortLink(
    projectId: string,
    linkId: string,
    userId: string,
    body: UpdateShortLinkDto,
  ): Promise<DeveloperShortLinkDto> {
    await this.assertProjectOwner(projectId, userId);
    const existing = await prisma.developerShortLink.findFirst({ where: { id: linkId, projectId } });
    if (!existing) throw new NotFoundError("短链接不存在");
    const targetUrl = body.targetUrl ? (await assertSafeOutboundUrl(body.targetUrl)).toString() : undefined;
    const link = await prisma.developerShortLink.update({
      where: { id: linkId },
      data: {
        targetUrl,
        enabled: body.enabled,
        expiresAt: body.expiresAt === null ? null : body.expiresAt ? new Date(body.expiresAt) : undefined,
      },
    });
    return this.shortLinkDto(link);
  }

  async deleteShortLink(projectId: string, linkId: string, userId: string): Promise<void> {
    await this.assertProjectOwner(projectId, userId);
    const result = await prisma.developerShortLink.deleteMany({ where: { id: linkId, projectId } });
    if (!result.count) throw new NotFoundError("短链接不存在");
  }

  async resolveShortLink(
    code: string,
    context?: { referrer?: string; userAgent?: string; country?: string },
  ): Promise<string> {
    const link = await prisma.developerShortLink.findFirst({ where: { code, status: 1, enabled: true } });
    if (!link || (link.expiresAt && link.expiresAt.getTime() <= Date.now()))
      throw new NotFoundError("短链接不存在或已过期");
    let sourceHost: string | undefined;
    if (context?.referrer) {
      try {
        sourceHost = new URL(context.referrer).hostname.slice(0, 255) || undefined;
      } catch {
        sourceHost = undefined;
      }
    }
    const country = context?.country?.trim().toUpperCase().slice(0, 8) || undefined;
    const userAgent = context?.userAgent?.trim().slice(0, 255) || undefined;
    void prisma
      .$transaction([
        prisma.developerShortLink.update({ where: { id: link.id }, data: { clickCount: { increment: 1 } } }),
        prisma.developerShortLinkClick.create({ data: { shortLinkId: link.id, sourceHost, userAgent, country } }),
      ])
      .catch(() => undefined);
    return link.targetUrl;
  }

  async getShortLinkStats(
    projectId: string,
    linkId: string,
    userId: string,
  ): Promise<DeveloperShortLinkStatsDto> {
    await this.assertProjectOwner(projectId, userId);
    const link = await prisma.developerShortLink.findFirst({ where: { id: linkId, projectId } });
    if (!link) throw new NotFoundError("短链接不存在");

    const periodEnd = new Date();
    const periodStart = new Date(periodEnd);
    periodStart.setDate(periodStart.getDate() - 29);
    periodStart.setHours(0, 0, 0, 0);
    const where = { shortLinkId: link.id, clickedAt: { gte: periodStart, lte: periodEnd } };
    const [sourceGroups, countryGroups, recentClicks] = await Promise.all([
      prisma.developerShortLinkClick.groupBy({
        by: ["sourceHost"],
        where,
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }),
      prisma.developerShortLinkClick.groupBy({
        by: ["country"],
        where,
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }),
      prisma.developerShortLinkClick.findMany({
        where,
        orderBy: { clickedAt: "desc" },
        take: 500,
        select: { clickedAt: true, sourceHost: true, country: true, userAgent: true },
      }),
    ]);
    const dailyCounts = new Map<string, number>();
    for (const click of recentClicks) {
      const day = click.clickedAt.toISOString().slice(0, 10);
      dailyCounts.set(day, (dailyCounts.get(day) ?? 0) + 1);
    }

    return {
      linkId: link.id,
      code: link.code,
      totalClicks: link.clickCount,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      clicksByDay: [...dailyCounts.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
      sources: sourceGroups.map((group) => ({ sourceHost: group.sourceHost ?? undefined, count: group._count.id })),
      countries: countryGroups.map((group) => ({ country: group.country ?? undefined, count: group._count.id })),
      recentClicks: recentClicks.map((click) => ({
        clickedAt: click.clickedAt.toISOString(),
        sourceHost: click.sourceHost ?? undefined,
        country: click.country ?? undefined,
        userAgent: click.userAgent ?? undefined,
      })),
    };
  }

  async getPublicStatusPage(slug: string) {
    const project = await prisma.developerProject.findFirst({
      where: { slug, status: 1, statusPagePublished: true },
      select: {
        name: true,
        slug: true,
        statusMonitors: {
          where: { enabled: true, status: 1 },
          select: {
            name: true,
            lastStatus: true,
            lastCheckedAt: true,
            checks: {
              orderBy: { checkedAt: "desc" },
              take: 30,
              select: { checkStatus: true, statusCode: true, latencyMs: true, checkedAt: true },
            },
          },
        },
      },
    });
    if (!project) throw new NotFoundError("状态页不存在");
    return {
      ...project,
      statusMonitors: project.statusMonitors.map((monitor) => {
        const successfulChecks = monitor.checks.filter((check) => check.checkStatus === "up").length;
        return {
          ...monitor,
          availability: monitor.checks.length ? successfulChecks / monitor.checks.length : null,
        };
      }),
    };
  }

  private getEncryptionKey(): Buffer {
    const secret = String(process.env.DEVELOPER_SECRETS_MASTER_KEY || "").trim();
    if (secret.length < 64) throw new BadRequestError("密钥托管未配置");
    return createHash("sha256").update(secret).digest();
  }

  private encryptSecret(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.getEncryptionKey(), iv);
    return {
      ciphertext: Buffer.concat([cipher.update(value, "utf8"), cipher.final()]).toString("base64"),
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
    };
  }

  private decryptSecret(record: { ciphertext: string; iv: string; authTag: string }): string {
    const decipher = createDecipheriv("aes-256-gcm", this.getEncryptionKey(), Buffer.from(record.iv, "base64"));
    decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64")), decipher.final()]).toString(
      "utf8",
    );
  }

  async upsertSecret(projectId: string, userId: string, body: UpsertDeveloperSecretDto): Promise<DeveloperSecretDto> {
    await this.assertProjectOwner(projectId, userId);
    const encrypted = this.encryptSecret(body.value);
    const record = await prisma.developerSecret.upsert({
      where: { projectId_alias: { projectId, alias: body.alias } },
      create: { projectId, alias: body.alias, ...encrypted },
      update: { ...encrypted, keyVersion: { increment: 1 }, lastUsedAt: null },
    });
    return {
      id: record.id,
      alias: record.alias,
      keyVersion: record.keyVersion,
      lastUsedAt: asIso(record.lastUsedAt),
      createTime: record.createTime.toISOString(),
      updateTime: record.updateTime.toISOString(),
    };
  }

  async listSecrets(projectId: string, userId: string): Promise<DeveloperSecretDto[]> {
    await this.assertProjectOwner(projectId, userId);
    const records = await prisma.developerSecret.findMany({
      where: { projectId, status: 1 },
      orderBy: { alias: "asc" },
    });
    return records.map((record) => ({
      id: record.id,
      alias: record.alias,
      keyVersion: record.keyVersion,
      lastUsedAt: asIso(record.lastUsedAt),
      createTime: record.createTime.toISOString(),
      updateTime: record.updateTime.toISOString(),
    }));
  }

  async deleteSecret(projectId: string, alias: string, userId: string): Promise<void> {
    await this.assertProjectOwner(projectId, userId);
    const result = await prisma.developerSecret.deleteMany({ where: { projectId, alias } });
    if (!result.count) throw new NotFoundError("密钥别名不存在");
  }

  async resolveSecret(projectId: string, alias: string): Promise<string> {
    const record = await prisma.developerSecret.findFirst({ where: { projectId, alias, status: 1 } });
    if (!record) throw new BadRequestError(`未定义的密钥别名: ${alias}`);
    const value = this.decryptSecret(record);
    void prisma.developerSecret.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } });
    return value;
  }

  async substituteSecretsForProject(projectId: string, userId: string, value: string): Promise<string> {
    await this.assertProjectOwner(projectId, userId);
    if (value.includes("{{") && !/\{\{[A-Z][A-Z0-9_]{0,99}\}\}/.test(value))
      throw new BadRequestError("密钥占位符格式无效");
    const aliases = [...value.matchAll(/\{\{([A-Z][A-Z0-9_]{0,99})\}\}/g)].map((match) => match[1]);
    if (!aliases.length) return value;

    let resolved = value;
    for (const alias of [...new Set(aliases)]) {
      const secret = await this.resolveSecret(projectId, alias);
      resolved = resolved.replaceAll(`{{${alias}}}`, secret);
    }
    if (resolved.length > 100_000) throw new BadRequestError("密钥替换后的内容超过大小限制");
    return resolved;
  }

  async substituteSecretsInJsonValue(projectId: string, userId: string, value: unknown): Promise<unknown> {
    const replace = async (current: unknown): Promise<unknown> => {
      if (typeof current === "string") return this.substituteSecretsForProject(projectId, userId, current);
      if (Array.isArray(current)) return Promise.all(current.map((item) => replace(item)));
      if (current && typeof current === "object") {
        const entries = await Promise.all(
          Object.entries(current as Record<string, unknown>).map(async ([key, item]) => [key, await replace(item)] as const),
        );
        return Object.fromEntries(entries);
      }
      return current;
    };
    const resolved = await replace(value);
    if (Buffer.byteLength(JSON.stringify(resolved)) > 100_000) throw new BadRequestError("密钥替换后的内容超过大小限制");
    return resolved;
  }

  async createStatusMonitor(
    projectId: string,
    userId: string,
    body: CreateDeveloperStatusMonitorDto,
  ): Promise<DeveloperStatusMonitorDto> {
    await this.assertProjectOwner(projectId, userId);
    const target = await assertSafeOutboundUrl(body.targetUrl);
    const monitor = await prisma.developerStatusMonitor.create({
      data: {
        projectId,
        name: body.name,
        targetUrl: target.toString(),
        method: body.method ?? "GET",
        intervalSec: body.intervalSec ?? 60,
        successStatusCodes: body.successStatusCodes,
      },
    });
    return this.monitorDto(monitor);
  }

  private monitorDto(monitor: {
    id: string;
    name: string;
    targetUrl: string;
    method: string;
    intervalSec: number;
    successStatusCodes: unknown;
    enabled: boolean;
    lastCheckedAt: Date | null;
    lastStatus: string | null;
  }): DeveloperStatusMonitorDto {
    return {
      ...monitor,
      successStatusCodes: Array.isArray(monitor.successStatusCodes)
        ? monitor.successStatusCodes.filter((code): code is number => typeof code === "number")
        : undefined,
      lastCheckedAt: asIso(monitor.lastCheckedAt),
      lastStatus: monitor.lastStatus ?? undefined,
    };
  }

  async listStatusMonitors(projectId: string, userId: string): Promise<DeveloperStatusMonitorDto[]> {
    await this.assertProjectOwner(projectId, userId);
    const monitors = await prisma.developerStatusMonitor.findMany({
      where: { projectId },
      orderBy: { createTime: "desc" },
    });
    return monitors.map((monitor) => this.monitorDto(monitor));
  }

  async updateStatusMonitor(
    projectId: string,
    monitorId: string,
    userId: string,
    body: UpdateDeveloperStatusMonitorDto,
  ): Promise<DeveloperStatusMonitorDto> {
    await this.assertProjectOwner(projectId, userId);
    const existing = await prisma.developerStatusMonitor.findFirst({ where: { id: monitorId, projectId } });
    if (!existing) throw new NotFoundError("监控目标不存在");
    const targetUrl = body.targetUrl ? (await assertSafeOutboundUrl(body.targetUrl)).toString() : undefined;
    const monitor = await prisma.developerStatusMonitor.update({
      where: { id: monitorId },
      data: {
        name: body.name,
        targetUrl,
        method: body.method,
        intervalSec: body.intervalSec,
        successStatusCodes: body.successStatusCodes,
        enabled: body.enabled,
      },
    });
    return this.monitorDto(monitor);
  }

  async deleteStatusMonitor(projectId: string, monitorId: string, userId: string): Promise<void> {
    await this.assertProjectOwner(projectId, userId);
    const result = await prisma.developerStatusMonitor.deleteMany({ where: { id: monitorId, projectId } });
    if (!result.count) throw new NotFoundError("监控目标不存在");
  }

  async checkStatusMonitor(projectId: string, monitorId: string, userId: string): Promise<DeveloperStatusMonitorDto> {
    await this.assertProjectOwner(projectId, userId);
    const monitor = await prisma.developerStatusMonitor.findFirst({ where: { id: monitorId, projectId } });
    if (!monitor) throw new NotFoundError("监控目标不存在");
    return this.performStatusCheck(monitor);
  }

  private async performStatusCheck(monitor: {
    id: string;
    targetUrl: string;
    method: string;
    successStatusCodes?: unknown;
    lastStatus?: string | null;
    project?: { userId: string };
  }): Promise<DeveloperStatusMonitorDto> {
    let lastStatus = "down";
    let statusCode: number | null = null;
    let errorMessage: string | null = null;
    const startedAt = Date.now();
    try {
      await assertSafeOutboundUrl(monitor.targetUrl);
      const response = await axios.request({
        url: monitor.targetUrl,
        method: monitor.method,
        timeout: 10_000,
        maxRedirects: 0,
        maxContentLength: MAX_OUTBOUND_RESPONSE_BYTES,
        validateStatus: () => true,
      });
      statusCode = response.status;
      const configuredCodes = Array.isArray(monitor.successStatusCodes)
        ? monitor.successStatusCodes.filter((code): code is number => typeof code === "number")
        : [];
      lastStatus = (configuredCodes.length ? configuredCodes.includes(response.status) : response.status >= 200 && response.status < 400)
        ? "up"
        : "down";
    } catch (error) {
      lastStatus = "down";
      errorMessage = error instanceof Error ? error.message.slice(0, 500) : "监控请求失败";
    }
    const checkedAt = new Date();
    const latencyMs = Date.now() - startedAt;
    const updated = await prisma.$transaction(async (tx) => {
      const updatedMonitor = await tx.developerStatusMonitor.update({
        where: { id: monitor.id },
        data: { lastCheckedAt: checkedAt, lastStatus },
      });
      await tx.developerStatusCheck.create({
        data: { monitorId: monitor.id, checkedAt, checkStatus: lastStatus, statusCode, latencyMs, errorMessage },
      });
      return updatedMonitor;
    });
    if (monitor.lastStatus && monitor.lastStatus !== lastStatus && monitor.project?.userId) {
      const recovered = lastStatus === "up";
      void NotificationService.getInstance().dispatch(
        monitor.project.userId,
        recovered ? NotificationEvent.DEVELOPER_MONITOR_RECOVERED : NotificationEvent.DEVELOPER_MONITOR_DOWN,
        {
          title: recovered ? "监控服务已恢复" : "监控服务异常",
          content: `监控目标已${recovered ? "恢复可用" : "不可用"}`,
          data: { monitorId: monitor.id, previousStatus: monitor.lastStatus, currentStatus: lastStatus, statusCode },
        },
      );
    }
    return this.monitorDto(updated);
  }

  async runScheduledMonitorChecks(): Promise<void> {
    const monitors = await prisma.developerStatusMonitor.findMany({
      where: { enabled: true, status: 1 },
      include: { project: { select: { userId: true } } },
    });
    const now = Date.now();
    const due = monitors.filter(
      (monitor) => !monitor.lastCheckedAt || now - monitor.lastCheckedAt.getTime() >= monitor.intervalSec * 1000,
    );
    await Promise.allSettled(due.map((monitor) => this.performStatusCheck(monitor)));
    const retentionCutoff = new Date(Date.now() - 90 * 24 * 60 * 60_000);
    await Promise.all([
      prisma.developerStatusCheck.deleteMany({ where: { checkedAt: { lt: retentionCutoff } } }),
      prisma.developerShortLinkClick.deleteMany({ where: { clickedAt: { lt: retentionCutoff } } }),
    ]);
  }

  private async assertVerificationRateLimit(
    projectId: string,
    body: SendDeveloperVerificationDto,
    sourceIpHash?: string,
  ): Promise<void> {
    const since = new Date(Date.now() - 10 * 60_000);
    const [projectCount, recipientCount, ipCount] = await Promise.all([
      prisma.developerVerification.count({ where: { projectId, createTime: { gte: since } } }),
      prisma.developerVerification.count({
        where: { projectId, recipient: body.recipient, purpose: body.purpose, createTime: { gte: since } },
      }),
      sourceIpHash
        ? prisma.developerVerification.count({ where: { projectId, sourceIpHash, createTime: { gte: since } } })
        : Promise.resolve(0),
    ]);
    if (projectCount >= 20 || recipientCount >= 3 || ipCount >= 10)
      throw new TooManyRequestsError("验证码发送过于频繁，请稍后再试");
  }

  async sendVerification(projectId: string, body: SendDeveloperVerificationDto, sourceIp?: string): Promise<void> {
    const sourceIpHash = sourceIp && isIP(sourceIp) ? hash(sourceIp) : undefined;
    await this.assertVerificationRateLimit(projectId, body, sourceIpHash);
    const code = String(Math.floor(100_000 + Math.random() * 900_000));
    const codeHash = hash(code);
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    let deliver: () => Promise<void>;
    if (body.channel === "email") {
      const smtp = await this.configService.getSmtpConfig();
      if (!smtp.host) throw new BadRequestError("SMTP 未配置");
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: { user: smtp.user, pass: smtp.password },
      });
      deliver = async () => {
        await transporter.sendMail({
          from: `"${smtp.senderName}" <${smtp.senderEmail}>`,
          to: body.recipient,
          subject: "验证码",
          text: `您的验证码是 ${code}，10 分钟内有效。`,
        });
      };
    } else {
      const config = await this.configService.getMultiple([
        CONFIG_KEYS.DEVELOPER.SMS_ENDPOINT,
        CONFIG_KEYS.DEVELOPER.SMS_TOKEN,
        CONFIG_KEYS.DEVELOPER.SMS_SENDER,
      ]);
      const endpoint = config[CONFIG_KEYS.DEVELOPER.SMS_ENDPOINT]?.trim();
      const token = config[CONFIG_KEYS.DEVELOPER.SMS_TOKEN]?.trim();
      if (!endpoint || !token)
        throw new BadRequestError("短信渠道未启用", CustomCode.DEVELOPER_CHANNEL_NOT_ENABLED);
      const target = await assertSafeOutboundUrl(endpoint);
      deliver = async () => {
        await axios.post(
          target.toString(),
          {
            to: body.recipient,
            code,
            purpose: body.purpose,
            sender: config[CONFIG_KEYS.DEVELOPER.SMS_SENDER]?.trim() || undefined,
          },
          {
            timeout: 10_000,
            maxRedirects: 0,
            maxContentLength: MAX_OUTBOUND_RESPONSE_BYTES,
            headers: { Authorization: `Bearer ${token}` },
          },
        );
      };
    }
    const receipt = await this.consumeQuota(projectId, "verification");
    try {
      await deliver();
      await prisma.developerVerification.updateMany({
        where: { projectId, recipient: body.recipient, purpose: body.purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await prisma.developerVerification.create({
        data: {
          projectId,
          channel: body.channel,
          recipient: body.recipient,
          purpose: body.purpose,
          sourceIpHash,
          codeHash,
          expiresAt,
        },
      });
    } catch (error) {
      await this.refundQuota(receipt).catch(() => {});
      throw error;
    }
  }

  async verifyCode(projectId: string, body: VerifyDeveloperCodeDto): Promise<boolean> {
    const record = await prisma.developerVerification.findFirst({
      where: {
        projectId,
        channel: body.channel,
        recipient: body.recipient,
        purpose: body.purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createTime: "desc" },
    });
    if (!record || record.remainingTries <= 0) return false;
    if (record.codeHash !== hash(body.code)) {
      await prisma.developerVerification.update({
        where: { id: record.id },
        data: { remainingTries: { decrement: 1 } },
      });
      return false;
    }
    await prisma.developerVerification.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    return true;
  }

  async lookupIp(projectId: string, requestedIp?: string) {
    const ip = requestedIp?.trim();
    if (!ip || !isIP(ip) || isPrivateAddress(ip)) throw new BadRequestError("仅支持公网 IP 地址");
    const receipt = await this.consumeQuota(projectId, "ip");
    const cached = this.ipLocationCache.get(ip);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) this.ipLocationCache.delete(ip);
    const endpoint = String(process.env.IP_GEOLOCATION_ENDPOINT || "").trim();
    if (!endpoint) throw new BadRequestError("IP 定位服务尚未配置");
    const base = await assertSafeOutboundUrl(endpoint);
    try {
      const response = await axios.get(
        new URL(encodeURIComponent(ip), `${base.toString().replace(/\/$/, "")}/`).toString(),
        { timeout: 5_000, maxRedirects: 0, maxContentLength: MAX_OUTBOUND_RESPONSE_BYTES },
      );
      const data = response.data as Record<string, unknown>;
      const result = {
        ip,
        country: data.country_name ?? data.country ?? null,
        region: data.region ?? data.region_name ?? null,
        city: data.city ?? null,
        asn: data.asn ?? null,
        isp: data.org ?? data.isp ?? null,
        source: "configured",
      };
      this.ipLocationCache.set(ip, { expiresAt: Date.now() + 5 * 60_000, value: result });
      return result;
    } catch (error) {
      await this.refundQuota(receipt).catch(() => {});
      throw error;
    }
  }

  async createPushChannel(projectId: string, userId: string, body: CreateDeveloperPushChannelDto) {
    await this.assertProjectOwner(projectId, userId);
    await assertSafeOutboundUrl(body.endpoint);
    if (body.secretAlias) await this.resolveSecret(projectId, body.secretAlias);
    const channel = await prisma.developerPushChannel.create({
      data: { projectId, name: body.name, type: body.type, endpoint: body.endpoint, secretAlias: body.secretAlias },
    });
    return this.pushChannelDto(channel);
  }

  private pushChannelDto(channel: {
    id: string;
    name: string;
    type: string;
    endpoint: string | null;
    secretAlias: string | null;
    enabled: boolean;
    createTime: Date;
    updateTime: Date;
  }): DeveloperPushChannelDto {
    return {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      endpoint: channel.endpoint ?? "",
      secretAlias: channel.secretAlias ?? undefined,
      enabled: channel.enabled,
      createTime: channel.createTime.toISOString(),
      updateTime: channel.updateTime.toISOString(),
    };
  }

  async listPushChannels(projectId: string, userId: string): Promise<DeveloperPushChannelDto[]> {
    await this.assertProjectOwner(projectId, userId);
    const channels = await prisma.developerPushChannel.findMany({
      where: { projectId },
      orderBy: { createTime: "desc" },
    });
    return channels.map((channel) => this.pushChannelDto(channel));
  }

  async updatePushChannel(
    projectId: string,
    channelId: string,
    userId: string,
    body: UpdateDeveloperPushChannelDto,
  ): Promise<DeveloperPushChannelDto> {
    await this.assertProjectOwner(projectId, userId);
    const existing = await prisma.developerPushChannel.findFirst({ where: { id: channelId, projectId } });
    if (!existing) throw new NotFoundError("推送渠道不存在");
    const endpoint = body.endpoint ? (await assertSafeOutboundUrl(body.endpoint)).toString() : undefined;
    const channel = await prisma.developerPushChannel.update({
      where: { id: channelId },
      data: {
        name: body.name,
        endpoint,
        secretAlias: body.secretAlias,
        enabled: body.enabled,
      },
    });
    return this.pushChannelDto(channel);
  }

  async deletePushChannel(projectId: string, channelId: string, userId: string): Promise<void> {
    await this.assertProjectOwner(projectId, userId);
    const result = await prisma.developerPushChannel.deleteMany({ where: { id: channelId, projectId } });
    if (!result.count) throw new NotFoundError("推送渠道不存在");
  }

  private toPushDeliveryDto(delivery: {
    id: string;
    channelId: string;
    deliveryStatus: string;
    attemptCount: number;
    nextRetryAt: Date | null;
    errorMessage: string | null;
    createTime: Date;
    updateTime: Date;
  }): DeveloperPushDeliveryDto {
    return {
      id: delivery.id,
      channelId: delivery.channelId,
      success: delivery.deliveryStatus === "success",
      error: delivery.errorMessage ?? undefined,
      status: delivery.deliveryStatus,
      attemptCount: delivery.attemptCount,
      nextRetryAt: asIso(delivery.nextRetryAt),
      createTime: delivery.createTime.toISOString(),
      updateTime: delivery.updateTime.toISOString(),
    };
  }

  async listPushDeliveries(projectId: string, userId: string): Promise<DeveloperPushDeliveryDto[]> {
    await this.assertProjectOwner(projectId, userId);
    const deliveries = await prisma.developerPushDelivery.findMany({
      where: { projectId },
      orderBy: { createTime: "desc" },
      take: 100,
    });
    return deliveries.map((delivery) => this.toPushDeliveryDto(delivery));
  }

  private async dispatchPushDelivery(
    delivery: { id: string; projectId: string; channelId: string; title: string; content: string },
    channel: { endpoint: string | null; secretAlias: string | null; type: string; enabled: boolean },
  ): Promise<DeveloperPushDeliveryDto> {
    try {
      if (!channel.enabled || !channel.endpoint) throw new BadRequestError("推送渠道未配置地址或已停用");
      await assertSafeOutboundUrl(channel.endpoint);
      const secret = channel.secretAlias ? await this.resolveSecret(delivery.projectId, channel.secretAlias) : undefined;
      const payload =
        channel.type === "dingtalk"
          ? { msgtype: "text", text: { content: `${delivery.title}\n${delivery.content}` } }
          : channel.type === "feishu"
            ? { msg_type: "text", content: { text: `${delivery.title}\n${delivery.content}` } }
            : { title: delivery.title, content: delivery.content };
      await axios.post(channel.endpoint, payload, {
        timeout: 10_000,
        maxRedirects: 0,
        maxContentLength: MAX_OUTBOUND_RESPONSE_BYTES,
        headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
      });
      const updated = await prisma.developerPushDelivery.update({
        where: { id: delivery.id },
        data: { deliveryStatus: "success", attemptCount: { increment: 1 }, nextRetryAt: null, errorMessage: null },
      });
      return this.toPushDeliveryDto(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "推送失败";
      const updated = await prisma.developerPushDelivery.update({
        where: { id: delivery.id },
        data: {
          deliveryStatus: "failed",
          attemptCount: { increment: 1 },
          nextRetryAt: new Date(Date.now() + 60_000),
          errorMessage: message,
        },
      });
      return this.toPushDeliveryDto(updated);
    }
  }

  async retryScheduledPushDeliveries(): Promise<void> {
    const deliveries = await prisma.developerPushDelivery.findMany({
      where: { deliveryStatus: "failed", nextRetryAt: { lte: new Date() }, attemptCount: { lt: 3 } },
      include: { channel: true },
      orderBy: { nextRetryAt: "asc" },
      take: 100,
    });
    await Promise.allSettled(deliveries.map((delivery) => this.dispatchPushDelivery(delivery, delivery.channel)));
  }

  async sendPush(projectId: string, body: SendDeveloperPushDto): Promise<DeveloperPushDeliveryDto[]> {
    if (body.idempotencyKey) {
      try {
        await prisma.developerPushRequest.create({ data: { projectId, idempotencyKey: body.idempotencyKey } });
      } catch (error: any) {
        if (error?.code !== "P2002") throw error;
        const existing = await prisma.developerPushDelivery.findMany({
          where: { projectId, idempotencyKey: body.idempotencyKey },
          orderBy: { createTime: "asc" },
        });
        return existing.map((delivery) => this.toPushDeliveryDto(delivery));
      }
    }
    try {
      const channels = await prisma.developerPushChannel.findMany({
        where: { projectId, id: { in: body.channelIds }, enabled: true, status: 1 },
      });
      if (!channels.length) throw new NotFoundError("未找到可用的推送渠道");
      const receipt = await this.consumeQuota(projectId, "push");
      const deliveries = await Promise.all(
        channels.map((channel) =>
          prisma.developerPushDelivery.create({
            data: {
              projectId,
              channelId: channel.id,
              title: body.title,
              content: body.content,
              idempotencyKey: body.idempotencyKey,
              deliveryStatus: "pending",
            },
          }),
        ),
      );
      const results = await Promise.all(
        deliveries.map((delivery) =>
          this.dispatchPushDelivery(delivery, channels.find((channel) => channel.id === delivery.channelId)!),
        ),
      );
      if (!results.some((result) => result.success)) await this.refundQuota(receipt).catch(() => {});
      if (body.idempotencyKey)
        await prisma.developerPushRequest.update({
          where: { projectId_idempotencyKey: { projectId, idempotencyKey: body.idempotencyKey } },
          data: { requestStatus: results.some((result) => result.success) ? "success" : "failed" },
        });
      return results;
    } catch (error) {
      if (body.idempotencyKey)
        await prisma.developerPushRequest.deleteMany({ where: { projectId, idempotencyKey: body.idempotencyKey } });
      throw error;
    }
  }
}

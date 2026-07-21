import { JsonEndpoint } from "@prisma/client";
import { createHash, createPublicKey, verify, type KeyObject } from "crypto";
import { JsonEndpointRepository } from "@/store/system/json-endpoint.repository";
import type { JsonEndpointStore } from "@/store/system/json-endpoint.store";
import {
  CreateJsonEndpointDto,
  UpdateJsonEndpointDto,
  JsonEndpointDto,
  JsonEndpointOwnerOptionDto,
  PublicJsonData,
} from "@/api/dto/json-endpoint/json-endpoint.dto";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { BadRequestError, NotFoundError, UnauthorizedError, ForbiddenError } from "@/util/errors";
import { UserRepository } from "@/store/users/user.repository";
import type { UserStore } from "@/store/users/user.store";
import { PermissionService } from "@/services/users/permission.service";
import { Permission } from "@/constant/permission";
import type { Request } from "express";
import bcrypt from "bcrypt";
import { RedisService } from "@/services/infrastructure/redis.service";

const ACCESS_MODE_STATIC_PASSWORD = "static-password";
const ACCESS_MODE_PUBLIC_KEY = "public-key";
const SIGNATURE_ALGORITHM = "Ed25519";
const SIGNATURE_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;
const SIGNATURE_NONCE_TTL_MS = SIGNATURE_TIMESTAMP_TOLERANCE_SECONDS * 1000;
const noncePattern = /^[A-Za-z0-9_-]{16,256}$/;
const signaturePattern = /^[A-Za-z0-9_-]{80,100}$/;

type JsonEndpointAccessMode = typeof ACCESS_MODE_STATIC_PASSWORD | typeof ACCESS_MODE_PUBLIC_KEY;

export interface JsonEndpointAccessCredentials {
  password?: string;
  timestamp?: string;
  nonce?: string;
  signature?: string;
  pathname?: string;
  originalUrl?: string;
}

export class JsonEndpointService {
  private static instance: JsonEndpointService;

  private constructor(
    private readonly repository: JsonEndpointStore = JsonEndpointRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly permissionService: PermissionService = PermissionService.getInstance(),
    private readonly redisService: RedisService = RedisService.getInstance(),
  ) {}

  public static getInstance(): JsonEndpointService {
    if (!JsonEndpointService.instance) JsonEndpointService.instance = new JsonEndpointService();

    return JsonEndpointService.instance;
  }

  private getClientIP(req?: Request): string {
    if (!req) return "unknown";
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return typeof forwarded === "string" ? forwarded.split(",")[0].trim() : forwarded[0];
    return req.ip || req.socket.remoteAddress || "unknown";
  }

  /**
   * 哈希密码
   */
  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  /**
   * 验证密码
   */
  private async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  private resolveAccessMode(endpoint: JsonEndpoint): JsonEndpointAccessMode | undefined {
    if (endpoint.isPublic) return undefined;
    return endpoint.accessMode === ACCESS_MODE_PUBLIC_KEY ? ACCESS_MODE_PUBLIC_KEY : ACCESS_MODE_STATIC_PASSWORD;
  }

  private normalizeEd25519PublicKey(value: string): { publicKey: string; fingerprint: string } {
    const input = value.trim();
    if (!/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/.test(input))
      throw new BadRequestError("公钥必须是 Ed25519 SPKI PEM 格式");

    let key: KeyObject;
    try {
      key = createPublicKey(input);
    } catch {
      throw new BadRequestError("公钥格式无效");
    }

    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") throw new BadRequestError("仅支持 Ed25519 公钥");

    const publicKey = key.export({ type: "spki", format: "pem" }).toString();
    return {
      publicKey,
      fingerprint: createHash("sha256").update(publicKey).digest("hex"),
    };
  }

  private createAccessConfig(
    isPublic: boolean,
    accessMode: JsonEndpointAccessMode | undefined,
    passwordHash?: string,
    publicKey?: { publicKey: string; fingerprint: string },
  ) {
    if (isPublic)
      return {
        isPublic: true,
        apiKey: null,
        accessMode: null,
        publicKey: null,
        publicKeyFingerprint: null,
        signatureAlgorithm: null,
      };

    if (accessMode === ACCESS_MODE_PUBLIC_KEY) {
      if (!publicKey) throw new BadRequestError("签名访问必须提供 Ed25519 公钥");
      return {
        isPublic: false,
        apiKey: null,
        accessMode: ACCESS_MODE_PUBLIC_KEY,
        publicKey: publicKey.publicKey,
        publicKeyFingerprint: publicKey.fingerprint,
        signatureAlgorithm: SIGNATURE_ALGORITHM,
      };
    }

    if (!passwordHash) throw new BadRequestError("非公开端点必须设置访问密码");
    return {
      isPublic: false,
      apiKey: passwordHash,
      accessMode: ACCESS_MODE_STATIC_PASSWORD,
      publicKey: null,
      publicKeyFingerprint: null,
      signatureAlgorithm: null,
    };
  }

  private getAuditChanges(
    data: CreateJsonEndpointDto | UpdateJsonEndpointDto,
    accessMode?: JsonEndpointAccessMode,
    publicKeyFingerprint?: string,
  ): Record<string, unknown> {
    return {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { descriptionUpdated: true } : {}),
      ...(data.jsonContent !== undefined ? { jsonContentUpdated: true } : {}),
      ...(data.isPublic !== undefined ? { isPublic: data.isPublic } : {}),
      ...(data.isRootSlug !== undefined ? { isRootSlug: data.isRootSlug } : {}),
      ...(accessMode ? { accessMode } : {}),
      ...(publicKeyFingerprint ? { publicKeyFingerprint } : {}),
    };
  }

  /**
   * 映射到 DTO
   */
  private getPublicPath(endpoint: JsonEndpoint, ownerUsername: string): string {
    return endpoint.isRootSlug ? `/v1/json/${endpoint.slug}` : `/v1/json/${ownerUsername}/${endpoint.slug}`;
  }

  private mapToDto(endpoint: JsonEndpoint, ownerUsername: string): JsonEndpointDto {
    return {
      id: endpoint.id,
      userId: endpoint.userId,
      ownerUsername,
      name: endpoint.name,
      slug: endpoint.slug,
      isRootSlug: endpoint.isRootSlug,
      publicUrl: this.getPublicPath(endpoint, ownerUsername),
      description: endpoint.description || undefined,
      jsonContent: endpoint.jsonContent,
      isPublic: endpoint.isPublic,
      hasPassword: this.resolveAccessMode(endpoint) === ACCESS_MODE_STATIC_PASSWORD && !!endpoint.apiKey,
      hasPublicKey: this.resolveAccessMode(endpoint) === ACCESS_MODE_PUBLIC_KEY && !!endpoint.publicKey,
      accessMode: this.resolveAccessMode(endpoint),
      publicKey: endpoint.publicKey || undefined,
      publicKeyFingerprint: endpoint.publicKeyFingerprint || undefined,
      signatureAlgorithm: endpoint.signatureAlgorithm || undefined,
      accessCount: endpoint.accessCount,
      lastAccessAt: endpoint.lastAccessAt?.toISOString(),
      createTime: endpoint.createTime.toISOString(),
      updateTime: endpoint.updateTime.toISOString(),
    };
  }

  private async getOwnerUsername(userId: string): Promise<string> {
    const owner = await this.userRepository.findById(userId);
    if (!owner) throw new NotFoundError("端点所属用户不存在");
    return owner.username;
  }

  private async canManage(actorUserId: string): Promise<boolean> {
    return this.permissionService.hasPermission(actorUserId, Permission.JSON_ENDPOINT_MANAGE);
  }

  private async assertCanAccessEndpoint(endpoint: JsonEndpoint, actorUserId: string): Promise<void> {
    if (endpoint.userId === actorUserId) return;
    if (!(await this.canManage(actorUserId))) throw new ForbiddenError("无权管理此端点");
  }

  private async assertCanSetRootSlug(actorUserId: string): Promise<void> {
    if (!(await this.permissionService.hasPermission(actorUserId, Permission.JSON_ENDPOINT_ROOT_SLUG)))
      throw new ForbiddenError("无权设置根 slug");
  }

  /**
   * 验证 slug 格式
   */
  private validateSlug(slug: string): void {
    const slugRegex = /^[a-z0-9-_]+$/;
    if (!slugRegex.test(slug)) throw new BadRequestError("Slug 仅允许小写字母、数字、连字符和下划线");
  }

  /**
   * 创建端点
   */
  async createEndpoint(data: CreateJsonEndpointDto, userId: string, request?: Request): Promise<JsonEndpointDto> {
    // 验证 slug 格式
    this.validateSlug(data.slug);

    const canManage = await this.canManage(userId);
    const ownerUserId = data.ownerUserId || userId;
    if (ownerUserId !== userId && !canManage) throw new ForbiddenError("无权指定端点所属用户");
    const ownerUsername = await this.getOwnerUsername(ownerUserId);
    const isRootSlug = data.isRootSlug === true;
    if (isRootSlug) {
      await this.assertCanSetRootSlug(userId);
      if (await this.repository.findByRootSlug(data.slug)) throw new BadRequestError("根 Slug 已被使用");
    } else if (await this.repository.findByUserAndSlug(ownerUsername, data.slug)) {
      throw new BadRequestError("该用户下 Slug 已被使用");
    }

    const accessMode = data.isPublic ? undefined : (data.accessMode ?? ACCESS_MODE_STATIC_PASSWORD);
    if (accessMode === ACCESS_MODE_STATIC_PASSWORD && !data.isPublic && !data.password)
      throw new BadRequestError("静态密码访问必须设置访问密码");
    if (accessMode === ACCESS_MODE_PUBLIC_KEY && !data.isPublic && !data.publicKey)
      throw new BadRequestError("签名访问必须提供 Ed25519 公钥");

    const passwordHash = !data.isPublic && data.password ? await this.hashPassword(data.password) : undefined;
    const normalizedPublicKey =
      !data.isPublic && data.accessMode === ACCESS_MODE_PUBLIC_KEY && data.publicKey
        ? this.normalizeEd25519PublicKey(data.publicKey)
        : undefined;
    const accessConfig = this.createAccessConfig(data.isPublic, accessMode, passwordHash, normalizedPublicKey);

    // 创建端点
    const endpoint = await this.repository.create({
      userId: ownerUserId,
      name: data.name,
      slug: data.slug,
      description: data.description,
      jsonContent: data.jsonContent,
      ...accessConfig,
      isRootSlug,
      rootSlug: isRootSlug ? data.slug : null,
    });

    // 记录业务日志
    await this.businessLogService.logOperation({
      operationType: OperationType.JSON_ENDPOINT_CREATE,
      operationCategory: OperationCategory.JSON_ENDPOINT,
      actorUserId: userId,
      targetUserId: ownerUserId,
      targetResourceId: endpoint.id,
      targetResourceType: "JSON_ENDPOINT",
      description: `创建 JSON 端点 '${endpoint.name}' (slug: ${endpoint.slug})`,
      changes: this.getAuditChanges(data, accessMode, normalizedPublicKey?.fingerprint),
      success: true,
      ipAddress: this.getClientIP(request),
      requestId: request?.headers["x-request-id"] as string | undefined,
    });

    return this.mapToDto(endpoint, ownerUsername);
  }

  /**
   * 获取端点详情
   */
  async getEndpoint(id: string, userId: string): Promise<JsonEndpointDto> {
    const endpoint = await this.repository.findById(id);
    if (!endpoint) throw new NotFoundError("端点不存在");

    await this.assertCanAccessEndpoint(endpoint, userId);
    return this.mapToDto(endpoint, await this.getOwnerUsername(endpoint.userId));
  }

  /**
   * 列出用户的所有端点
   */
  async listEndpoints(userId: string, ownerUserId?: string): Promise<JsonEndpointDto[]> {
    const canManage = await this.canManage(userId);
    if (ownerUserId && ownerUserId !== userId && !canManage) throw new ForbiddenError("无权查看其他用户端点");
    const endpoints =
      canManage && !ownerUserId
        ? await this.repository.findAll()
        : await this.repository.findByUserId(ownerUserId || userId);
    return Promise.all(
      endpoints.map(async (endpoint) => this.mapToDto(endpoint, await this.getOwnerUsername(endpoint.userId))),
    );
  }

  async listOwnerOptions(actorUserId: string): Promise<JsonEndpointOwnerOptionDto[]> {
    if (!(await this.canManage(actorUserId))) throw new ForbiddenError("无权管理端点所属用户");
    const users = await this.userRepository.listNonDeleted();
    return users
      .filter((user) => user.status === 1)
      .map((user) => ({ id: user.id, username: user.username }))
      .sort((left, right) => left.username.localeCompare(right.username));
  }

  /**
   * 更新端点
   */
  async updateEndpoint(
    id: string,
    data: UpdateJsonEndpointDto,
    userId: string,
    request?: Request,
  ): Promise<JsonEndpointDto> {
    const endpoint = await this.repository.findById(id);
    if (!endpoint) throw new NotFoundError("端点不存在");

    await this.assertCanAccessEndpoint(endpoint, userId);

    // 准备更新数据
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.jsonContent !== undefined) updateData.jsonContent = data.jsonContent;
    if (data.isRootSlug !== undefined && data.isRootSlug !== endpoint.isRootSlug) {
      await this.assertCanSetRootSlug(userId);
      if (data.isRootSlug && (await this.repository.findByRootSlug(endpoint.slug)))
        throw new BadRequestError("根 Slug 已被使用");
      updateData.isRootSlug = data.isRootSlug;
      updateData.rootSlug = data.isRootSlug ? endpoint.slug : null;
    }

    const finalIsPublic = data.isPublic ?? endpoint.isPublic;
    const existingAccessMode = this.resolveAccessMode(endpoint);
    const finalAccessMode = finalIsPublic
      ? undefined
      : (data.accessMode ?? (endpoint.isPublic ? undefined : existingAccessMode) ?? ACCESS_MODE_STATIC_PASSWORD);

    if (!finalIsPublic && data.password && finalAccessMode !== ACCESS_MODE_STATIC_PASSWORD)
      throw new BadRequestError("只有静态密码模式可以设置访问密码");
    if (!finalIsPublic && data.publicKey && finalAccessMode !== ACCESS_MODE_PUBLIC_KEY)
      throw new BadRequestError("只有 Ed25519 签名模式可以设置公钥");

    let passwordHash: string | undefined;
    let normalizedPublicKey: { publicKey: string; fingerprint: string } | undefined;
    if (!finalIsPublic && finalAccessMode === ACCESS_MODE_STATIC_PASSWORD) {
      if (data.password) passwordHash = await this.hashPassword(data.password);
      else if (existingAccessMode !== ACCESS_MODE_STATIC_PASSWORD || !endpoint.apiKey)
        throw new BadRequestError("静态密码访问必须设置访问密码");
    }
    if (!finalIsPublic && finalAccessMode === ACCESS_MODE_PUBLIC_KEY) {
      if (data.publicKey) normalizedPublicKey = this.normalizeEd25519PublicKey(data.publicKey);
      else if (existingAccessMode !== ACCESS_MODE_PUBLIC_KEY || !endpoint.publicKey)
        throw new BadRequestError("签名访问必须提供 Ed25519 公钥");
    }

    const accessConfig = this.createAccessConfig(
      finalIsPublic,
      finalAccessMode,
      passwordHash ?? (finalAccessMode === ACCESS_MODE_STATIC_PASSWORD ? endpoint.apiKey || undefined : undefined),
      normalizedPublicKey ??
        (finalAccessMode === ACCESS_MODE_PUBLIC_KEY && endpoint.publicKey && endpoint.publicKeyFingerprint
          ? { publicKey: endpoint.publicKey, fingerprint: endpoint.publicKeyFingerprint }
          : undefined),
    );
    Object.assign(updateData, accessConfig);

    // 更新端点
    const updated = await this.repository.update(id, updateData);

    // 记录业务日志
    await this.businessLogService.logOperation({
      operationType: OperationType.JSON_ENDPOINT_UPDATE,
      operationCategory: OperationCategory.JSON_ENDPOINT,
      actorUserId: userId,
      targetUserId: endpoint.userId,
      targetResourceId: id,
      targetResourceType: "JSON_ENDPOINT",
      description: `更新 JSON 端点 '${updated.name}' (slug: ${updated.slug})`,
      changes: this.getAuditChanges(data, finalAccessMode, normalizedPublicKey?.fingerprint),
      success: true,
      ipAddress: this.getClientIP(request),
      requestId: request?.headers["x-request-id"] as string | undefined,
    });

    return this.mapToDto(updated, await this.getOwnerUsername(updated.userId));
  }

  /**
   * 删除端点
   */
  async deleteEndpoint(id: string, userId: string, request?: Request): Promise<void> {
    const endpoint = await this.repository.findById(id);
    if (!endpoint) throw new NotFoundError("端点不存在");

    await this.assertCanAccessEndpoint(endpoint, userId);

    await this.repository.delete(id);

    // 记录业务日志
    await this.businessLogService.logOperation({
      operationType: OperationType.JSON_ENDPOINT_DELETE,
      operationCategory: OperationCategory.JSON_ENDPOINT,
      actorUserId: userId,
      targetUserId: endpoint.userId,
      targetResourceId: id,
      targetResourceType: "JSON_ENDPOINT",
      description: `删除 JSON 端点 '${endpoint.name}' (slug: ${endpoint.slug})`,
      success: true,
      ipAddress: this.getClientIP(request),
      requestId: request?.headers["x-request-id"] as string | undefined,
    });
  }

  private getCanonicalQuery(originalUrl?: string): string {
    const query = originalUrl?.includes("?") ? originalUrl.slice(originalUrl.indexOf("?") + 1) : "";
    return Array.from(new URLSearchParams(query).entries())
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .sort()
      .join("&");
  }

  private async verifySignatureAccess(
    endpoint: JsonEndpoint,
    credentials: JsonEndpointAccessCredentials,
  ): Promise<void> {
    const { timestamp, nonce, signature, pathname } = credentials;
    if (!timestamp || !nonce || !signature || !pathname) throw new UnauthorizedError("此端点需要 Ed25519 签名访问");
    if (!/^\d{10}$/.test(timestamp)) throw new UnauthorizedError("签名时间戳无效");
    if (!noncePattern.test(nonce)) throw new UnauthorizedError("签名 nonce 无效");
    if (!signaturePattern.test(signature)) throw new UnauthorizedError("签名格式无效");

    const timestampSeconds = Number(timestamp);
    const now = Math.floor(Date.now() / 1000);
    if (
      !Number.isSafeInteger(timestampSeconds) ||
      Math.abs(now - timestampSeconds) > SIGNATURE_TIMESTAMP_TOLERANCE_SECONDS
    )
      throw new UnauthorizedError("签名请求已过期");
    if (!endpoint.publicKey || endpoint.signatureAlgorithm !== SIGNATURE_ALGORITHM)
      throw new ForbiddenError("端点签名配置错误");

    let publicKey: KeyObject;
    try {
      publicKey = createPublicKey(endpoint.publicKey);
      if (publicKey.type !== "public" || publicKey.asymmetricKeyType !== "ed25519") throw new Error("unsupported key");
    } catch {
      throw new ForbiddenError("端点签名配置错误");
    }

    let signatureBuffer: Buffer;
    try {
      signatureBuffer = Buffer.from(signature, "base64url");
    } catch {
      throw new UnauthorizedError("签名格式无效");
    }
    if (signatureBuffer.length !== 64) throw new UnauthorizedError("签名格式无效");

    const canonicalPayload = ["GET", pathname, this.getCanonicalQuery(credentials.originalUrl), timestamp, nonce].join(
      "\n",
    );
    if (!verify(null, Buffer.from(canonicalPayload), publicKey, signatureBuffer))
      throw new ForbiddenError("签名验证失败");

    if (!this.redisService.isRedisAvailable()) throw new UnauthorizedError("签名服务暂不可用");
    const nonceKey = `json-endpoint:signature-nonce:${endpoint.id}:${nonce}`;
    const reserved = await this.redisService.setIfNotExists(nonceKey, "1", SIGNATURE_NONCE_TTL_MS);
    if (reserved === null) throw new UnauthorizedError("签名服务暂不可用");
    if (!reserved) throw new UnauthorizedError("签名 nonce 已被使用");
  }

  /**
   * 公开访问端点
   */
  private async accessResolvedEndpoint(
    endpoint: JsonEndpoint | null,
    credentials: JsonEndpointAccessCredentials = {},
  ): Promise<PublicJsonData> {
    if (!endpoint) throw new NotFoundError("端点不存在");

    // 验证访问权限
    if (!endpoint.isPublic) {
      if (this.resolveAccessMode(endpoint) === ACCESS_MODE_PUBLIC_KEY) {
        await this.verifySignatureAccess(endpoint, credentials);
      } else {
        if (!credentials.password) throw new UnauthorizedError("此端点需要访问密码");
        if (!endpoint.apiKey) throw new ForbiddenError("端点配置错误");

        const isValid = await this.verifyPassword(credentials.password, endpoint.apiKey);
        if (!isValid) throw new ForbiddenError("密码错误");
      }
    }

    // 增加访问计数 (fire-and-forget)
    this.repository.incrementAccessCount(endpoint.id);

    const ownerUsername = await this.getOwnerUsername(endpoint.userId);
    return {
      data: endpoint.jsonContent,
      slug: endpoint.slug,
      ownerUsername,
      publicUrl: this.getPublicPath(endpoint, ownerUsername),
      lastUpdated: endpoint.updateTime.toISOString(),
    };
  }

  async accessRootEndpoint(slug: string, credentials?: JsonEndpointAccessCredentials): Promise<PublicJsonData> {
    return this.accessResolvedEndpoint(await this.repository.findByRootSlug(slug), credentials);
  }

  async accessNamespacedEndpoint(
    username: string,
    slug: string,
    credentials?: JsonEndpointAccessCredentials,
  ): Promise<PublicJsonData> {
    return this.accessResolvedEndpoint(await this.repository.findByUserAndSlug(username, slug), credentials);
  }
}

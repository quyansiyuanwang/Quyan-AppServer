import { JsonEndpoint } from "@prisma/client";
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

export class JsonEndpointService {
  private static instance: JsonEndpointService;

  private constructor(
    private readonly repository: JsonEndpointStore = JsonEndpointRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly permissionService: PermissionService = PermissionService.getInstance(),
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
      hasPassword: !!endpoint.apiKey, // apiKey 字段现在存储密码哈希
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

    // 如果非公开，必须提供密码
    if (!data.isPublic && !data.password) throw new BadRequestError("非公开端点必须设置访问密码");

    // 哈希密码
    let passwordHash: string | undefined;
    if (!data.isPublic && data.password) passwordHash = await this.hashPassword(data.password);

    // 创建端点
    const endpoint = await this.repository.create({
      userId: ownerUserId,
      name: data.name,
      slug: data.slug,
      description: data.description,
      jsonContent: data.jsonContent,
      apiKey: passwordHash, // 存储密码哈希
      isPublic: data.isPublic,
      isRootSlug,
      rootSlug: isRootSlug ? data.slug : null,
    });

    // 记录业务日志
    await this.businessLogService.logOperation({
      operationType: OperationType.JSON_ENDPOINT_CREATE,
      operationCategory: OperationCategory.JSON_ENDPOINT,
      actorUserId: userId,
      targetResourceId: endpoint.id,
      targetResourceType: "JSON_ENDPOINT",
      description: `创建 JSON 端点 '${endpoint.name}' (slug: ${endpoint.slug})`,
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
    if (data.isPublic !== undefined) updateData.isPublic = data.isPublic;
    if (data.isRootSlug !== undefined && data.isRootSlug !== endpoint.isRootSlug) {
      await this.assertCanSetRootSlug(userId);
      if (data.isRootSlug && (await this.repository.findByRootSlug(endpoint.slug)))
        throw new BadRequestError("根 Slug 已被使用");
      updateData.isRootSlug = data.isRootSlug;
      updateData.rootSlug = data.isRootSlug ? endpoint.slug : null;
    }

    // 更新密码
    if (data.password) updateData.apiKey = await this.hashPassword(data.password);

    // 如果改为公开，清除密码
    if (data.isPublic === true) updateData.apiKey = null;

    // 更新端点
    const updated = await this.repository.update(id, updateData);

    // 记录业务日志
    await this.businessLogService.logOperation({
      operationType: OperationType.JSON_ENDPOINT_UPDATE,
      operationCategory: OperationCategory.JSON_ENDPOINT,
      actorUserId: userId,
      targetResourceId: id,
      targetResourceType: "JSON_ENDPOINT",
      description: `更新 JSON 端点 '${updated.name}' (slug: ${updated.slug})`,
      changes: data,
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
      targetResourceId: id,
      targetResourceType: "JSON_ENDPOINT",
      description: `删除 JSON 端点 '${endpoint.name}' (slug: ${endpoint.slug})`,
      success: true,
      ipAddress: this.getClientIP(request),
      requestId: request?.headers["x-request-id"] as string | undefined,
    });
  }

  /**
   * 公开访问端点
   */
  private async accessResolvedEndpoint(endpoint: JsonEndpoint | null, password?: string): Promise<PublicJsonData> {
    if (!endpoint) throw new NotFoundError("端点不存在");

    // 验证访问权限
    if (!endpoint.isPublic) {
      if (!password) throw new UnauthorizedError("此端点需要访问密码");

      if (!endpoint.apiKey) throw new ForbiddenError("端点配置错误");

      const isValid = await this.verifyPassword(password, endpoint.apiKey);
      if (!isValid) throw new ForbiddenError("密码错误");
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

  async accessRootEndpoint(slug: string, password?: string): Promise<PublicJsonData> {
    return this.accessResolvedEndpoint(await this.repository.findByRootSlug(slug), password);
  }

  async accessNamespacedEndpoint(username: string, slug: string, password?: string): Promise<PublicJsonData> {
    return this.accessResolvedEndpoint(await this.repository.findByUserAndSlug(username, slug), password);
  }
}

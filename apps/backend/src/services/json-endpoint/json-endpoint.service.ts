import { JsonEndpoint } from "@prisma/client";
import { JsonEndpointRepository } from "@/store/system/json-endpoint.repository";
import type { JsonEndpointStore } from "@/store/system/json-endpoint.store";
import {
  CreateJsonEndpointDto,
  UpdateJsonEndpointDto,
  JsonEndpointDto,
  PublicJsonData,
} from "@/api/dto/json-endpoint/json-endpoint.dto";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { BadRequestError, NotFoundError, UnauthorizedError, ForbiddenError } from "@/util/errors";
import type { Request } from "express";
import bcrypt from "bcrypt";

export class JsonEndpointService {
  private static instance: JsonEndpointService;

  private constructor(
    private readonly repository: JsonEndpointStore = JsonEndpointRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
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
  private mapToDto(endpoint: JsonEndpoint): JsonEndpointDto {
    return {
      id: endpoint.id,
      userId: endpoint.userId,
      name: endpoint.name,
      slug: endpoint.slug,
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

    // 检查 slug 唯一性
    const existing = await this.repository.findBySlug(data.slug);
    if (existing) throw new BadRequestError("Slug 已被使用");

    // 如果非公开，必须提供密码
    if (!data.isPublic && !data.password) throw new BadRequestError("非公开端点必须设置访问密码");

    // 哈希密码
    let passwordHash: string | undefined;
    if (!data.isPublic && data.password) passwordHash = await this.hashPassword(data.password);

    // 创建端点
    const endpoint = await this.repository.create({
      userId,
      name: data.name,
      slug: data.slug,
      description: data.description,
      jsonContent: data.jsonContent,
      apiKey: passwordHash, // 存储密码哈希
      isPublic: data.isPublic,
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

    return this.mapToDto(endpoint);
  }

  /**
   * 获取端点详情
   */
  async getEndpoint(id: string, userId: string): Promise<JsonEndpointDto> {
    const endpoint = await this.repository.findById(id);
    if (!endpoint) throw new NotFoundError("端点不存在");

    // 验证所有权
    if (endpoint.userId !== userId) throw new ForbiddenError("无权访问此端点");

    return this.mapToDto(endpoint);
  }

  /**
   * 列出用户的所有端点
   */
  async listEndpoints(userId: string): Promise<JsonEndpointDto[]> {
    const endpoints = await this.repository.findByUserId(userId);
    return endpoints.map((e) => this.mapToDto(e));
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

    // 验证所有权
    if (endpoint.userId !== userId) throw new ForbiddenError("无权修改此端点");

    // 准备更新数据
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.jsonContent !== undefined) updateData.jsonContent = data.jsonContent;
    if (data.isPublic !== undefined) updateData.isPublic = data.isPublic;

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

    return this.mapToDto(updated);
  }

  /**
   * 删除端点
   */
  async deleteEndpoint(id: string, userId: string, request?: Request): Promise<void> {
    const endpoint = await this.repository.findById(id);
    if (!endpoint) throw new NotFoundError("端点不存在");

    // 验证所有权
    if (endpoint.userId !== userId) throw new ForbiddenError("无权删除此端点");

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
  async accessEndpoint(slug: string, password?: string): Promise<PublicJsonData> {
    const endpoint = await this.repository.findBySlug(slug);
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

    return {
      data: endpoint.jsonContent,
      slug: endpoint.slug,
      lastUpdated: endpoint.updateTime.toISOString(),
    };
  }
}

import { NotFoundError } from "@/util/errors";
import { randomBytes } from "crypto";
import { UserRepository } from "@/store/users/user.repository";
import { OJAPIKeyRepository } from "@/store/oj-submitter/oj-apikey.repository";
import type { UserStore } from "@/store/users/user.store";
import type { OJAPIKeyStore } from "@/store/oj-submitter/oj-apikey.store";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import type { Request } from "express";
import { RelayChannelService } from "@/services/relay/relay-channel.service";

export class OJAPIKeyService {
  private static instance: OJAPIKeyService;

  private constructor(
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly ojApiKeyRepository: OJAPIKeyStore = OJAPIKeyRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly relayChannelService: RelayChannelService = RelayChannelService.getInstance(),
  ) {}

  static getInstance() {
    if (!this.instance) this.instance = new OJAPIKeyService();
    return this.instance;
  }

  /**
   * 生成API密钥
   */
  private generateAPIKey(): string {
    const randomPart = randomBytes(32).toString("hex");
    return `ojqa_${randomPart}`;
  }

  /**
   * 创建API密钥
   */
  async createAPIKey(userId: string, name?: string, expiresAt?: Date, channelId?: string, request?: Request) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError("User not found");
    if (channelId) await this.relayChannelService.assertChannelBusinessSelectableById(channelId, userId);

    const key = this.generateAPIKey();

    const apiKey = await this.ojApiKeyRepository.create({
      userId,
      name,
      key,
      expiresAt,
      channelId,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.OJ_APIKEY_CREATE,
      operationCategory: OperationCategory.OJ_SUBMITTER,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: apiKey.id,
      targetResourceType: "OJ_API_KEY",
      description: `创建了 OJ API Key '${apiKey.name || apiKey.id}'`,
      changes: {
        name: apiKey.name,
        expiresAt: apiKey.expiresAt,
        channelId: apiKey.channelId,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return apiKey;
  }

  /**
   * 获取用户的所有API密钥
   */
  async listAPIKeys(userId: string) {
    return this.ojApiKeyRepository.listActiveByUserId(userId);
  }

  /**
   * 获取单个API密钥详情
   */
  async getAPIKey(id: string, userId: string) {
    const key = await this.ojApiKeyRepository.findActiveByIdAndUserId(id, userId);

    if (!key) throw new NotFoundError("API key not found");

    return key;
  }

  /**
   * 删除API密钥
   */
  async deleteAPIKey(id: string, userId: string, request?: Request) {
    const key = await this.ojApiKeyRepository.findActiveByIdAndUserId(id, userId);

    if (!key) throw new NotFoundError("API key not found");

    await this.ojApiKeyRepository.softDeleteById(id);

    await this.businessLogService.logOperation({
      operationType: OperationType.OJ_APIKEY_DELETE,
      operationCategory: OperationCategory.OJ_SUBMITTER,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: key.id,
      targetResourceType: "OJ_API_KEY",
      description: `删除了 OJ API Key '${key.name || key.id}'`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return { success: true };
  }

  /**
   * 更新API密钥
   */
  async updateAPIKey(
    id: string,
    userId: string,
    data: { name?: string; expiresAt?: Date | null; channelId?: string | null },
    request?: Request,
  ) {
    const key = await this.ojApiKeyRepository.findActiveByIdAndUserId(id, userId);

    if (!key) throw new NotFoundError("API key not found");
    if (data.channelId) await this.relayChannelService.assertChannelBusinessSelectableById(data.channelId, userId);

    const updated = await this.ojApiKeyRepository.updateById(id, data);

    await this.businessLogService.logOperation({
      operationType: OperationType.OJ_APIKEY_UPDATE,
      operationCategory: OperationCategory.OJ_SUBMITTER,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: updated.id,
      targetResourceType: "OJ_API_KEY",
      description: `更新了 OJ API Key '${updated.name || updated.id}'`,
      changes: data,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return updated;
  }

  /**
   * 获取API密钥统计信息
   */
  async getAPIKeyStats(userId: string) {
    const [totalKeys, activeKeys, usage] = await Promise.all([
      this.ojApiKeyRepository.countActiveByUserId(userId),
      this.ojApiKeyRepository.countActiveUnexpiredByUserId(userId),
      this.ojApiKeyRepository.aggregateUsageByUserId(userId),
    ]);

    return {
      totalKeys,
      activeKeys,
      totalRequests: usage.requestCount,
      totalTokens: usage.totalTokens,
    };
  }
}

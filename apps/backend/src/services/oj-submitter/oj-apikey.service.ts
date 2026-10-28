import { OjApiKeyMutationIamService } from "./oj-apikey-mutation-iam.service";
import { env } from "@/config/env";
import type { TypedRequest } from "@/types/express";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { PermissionService } from "@/services/users/permission.service";
import { Permission } from "@quyan/shared";
import { OjApiKeyIamService } from "./oj-apikey-iam.service";
import { ojApiKeyDenied } from "@/store/oj-submitter/oj-apikey-management.repository";
import { getLogger, LogCategory } from "@/util/logger";
import { NotFoundError } from "@/util/errors";
import { getCredentialPrefix, toCanonicalCredential } from "@quyan/shared";
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

const canonicalizeOjApiKey = <T extends { key?: unknown }>(apiKey: T): T => {
  if (typeof apiKey.key !== "string") return apiKey;
  return { ...apiKey, key: toCanonicalCredential(apiKey.key, "ojApiKey") };
};

export class OJAPIKeyService {
  private static instance: OJAPIKeyService;

  private constructor(
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly ojApiKeyRepository: OJAPIKeyStore = OJAPIKeyRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly relayChannelService: RelayChannelService = RelayChannelService.getInstance(),
    private readonly iam = OjApiKeyIamService.getInstance(),
    private readonly permissions = PermissionService.getInstance(),
    private readonly mutations = OjApiKeyMutationIamService.getInstance(),
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
    return `${getCredentialPrefix("ojApiKey")}${randomPart}`;
  }

  /**
   * 创建API密钥
   */
  async createAPIKey(userId: string, name?: string, expiresAt?: Date, channelId?: string, request?: Request) {
    let apiKey;
    if (env.security.iamAuthorizationMode === "enforce")
      apiKey = await this.mutations.create(
        userId,
        { name, expiresAt, channelId },
        this.generateAPIKey(),
        request as TypedRequest,
      );
    else {
      if (request) {
        const principal = getIamPrincipal(request as TypedRequest);
        if (!principal || principal.subjectUserId !== userId || principal.principalUserId !== userId)
          throw ojApiKeyDenied();
        if (
          !(
            await this.permissions.checkUserPermissions(userId, [Permission.OJ_APIKEY_CREATE], {
              assumedRoleSessionId: principal.roleSessionId,
            })
          ).hasPermission
        )
          throw ojApiKeyDenied();
        await this.shadowRead(
          () => this.mutations.prepareCreate(userId, { name, expiresAt, channelId }, request as TypedRequest),
          request as TypedRequest,
        );
      }
      const user = await this.userRepository.findById(userId);
      if (!user) throw new NotFoundError("User not found", undefined, { messageKey: "user.notFound" });
      if (channelId) await this.relayChannelService.assertChannelBusinessSelectableById(channelId, userId);
      apiKey = await this.ojApiKeyRepository.create({ userId, name, key: this.generateAPIKey(), expiresAt, channelId });
    }

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

    return canonicalizeOjApiKey(apiKey);
  }

  private async legacyRead(userId: string, request?: TypedRequest) {
    if (!request) return;
    const principal = getIamPrincipal(request);
    if (!principal || principal.subjectUserId !== userId || principal.principalUserId !== userId)
      throw ojApiKeyDenied();
    const result = await this.permissions.checkUserPermissions(userId, [Permission.OJ_APIKEY_READ], {
      assumedRoleSessionId: principal.roleSessionId,
    });
    if (!result.hasPermission) throw ojApiKeyDenied();
  }
  private async shadowRead(operation: () => Promise<unknown>, request?: TypedRequest) {
    if (env.security.iamAuthorizationMode !== "shadow" || !request) return;
    try {
      await operation();
    } catch {
      getLogger("OjApiKeyIamBridge", LogCategory.SECURITY).warn("OJ API Key IAM shadow read denied", {
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
  }
  /**
   * 获取用户的所有API密钥
   */
  async listAPIKeys(userId: string, request?: TypedRequest) {
    if (env.security.iamAuthorizationMode === "enforce") return this.iam.list(userId, request);
    await this.legacyRead(userId, request);
    await this.shadowRead(() => this.iam.list(userId, request), request);
    return (await this.ojApiKeyRepository.listActiveByUserId(userId)).map(canonicalizeOjApiKey);
  }

  /**
   * 获取单个API密钥详情
   */
  async getAPIKey(id: string, userId: string, request?: TypedRequest) {
    if (env.security.iamAuthorizationMode === "enforce") return this.iam.get(userId, id, request);
    await this.legacyRead(userId, request);
    await this.shadowRead(() => this.iam.get(userId, id, request), request);
    const key = await this.ojApiKeyRepository.findActiveByIdAndUserId(id, userId);

    if (!key) throw new NotFoundError("API key not found", undefined, { messageKey: "ojSubmitter.apiKeyNotFound" });

    return canonicalizeOjApiKey(key);
  }

  /**
   * 删除API密钥
   */
  async deleteAPIKey(id: string, userId: string, request?: Request) {
    let key: { id: string; userId: string; name: string | null };
    if (env.security.iamAuthorizationMode === "enforce")
      key = await this.iam.revoke(userId, id, request as TypedRequest | undefined);
    else {
      if (request) {
        const principal = getIamPrincipal(request as TypedRequest);
        if (!principal || principal.subjectUserId !== userId) throw ojApiKeyDenied();
        const result = await this.permissions.checkUserPermissions(userId, [Permission.OJ_APIKEY_DELETE], {
          assumedRoleSessionId: principal.roleSessionId,
        });
        if (!result.hasPermission) throw ojApiKeyDenied();
      }
      if (env.security.iamAuthorizationMode === "shadow" && request) {
        try {
          await this.iam.authorizeDeletion(userId, id, request as TypedRequest);
        } catch {
          getLogger("OjApiKeyIamBridge", LogCategory.SECURITY).warn("OJ API Key IAM shadow evaluation denied", {
            action: "quyan:oj:DeleteApiKey",
            reason: "iam-evaluation-denied-or-unavailable",
          });
        }
      }
      const record = await this.ojApiKeyRepository.findActiveByIdAndUserId(id, userId);
      if (!record || record.userId !== userId)
        throw new NotFoundError("API key not found", undefined, { messageKey: "ojSubmitter.apiKeyNotFound" });
      key = record;
      await this.ojApiKeyRepository.softDeleteById(id);
    }

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
    let updated;
    if (env.security.iamAuthorizationMode === "enforce")
      updated = await this.mutations.update(id, userId, data, request as TypedRequest);
    else {
      if (request) {
        const principal = getIamPrincipal(request as TypedRequest);
        if (!principal || principal.subjectUserId !== userId || principal.principalUserId !== userId)
          throw ojApiKeyDenied();
        if (
          !(
            await this.permissions.checkUserPermissions(userId, [Permission.OJ_APIKEY_UPDATE], {
              assumedRoleSessionId: principal.roleSessionId,
            })
          ).hasPermission
        )
          throw ojApiKeyDenied();
        await this.shadowRead(
          () => this.mutations.prepareUpdate(id, userId, data, request as TypedRequest),
          request as TypedRequest,
        );
      }
      const key = await this.ojApiKeyRepository.findActiveByIdAndUserId(id, userId);
      if (!key) throw new NotFoundError("API key not found", undefined, { messageKey: "ojSubmitter.apiKeyNotFound" });
      if (data.channelId) await this.relayChannelService.assertChannelBusinessSelectableById(data.channelId, userId);
      updated = await this.ojApiKeyRepository.updateById(id, data);
    }

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

    return canonicalizeOjApiKey(updated);
  }

  /**
   * 获取API密钥统计信息
   */
  async getAPIKeyStats(userId: string, request?: TypedRequest) {
    if (env.security.iamAuthorizationMode === "enforce") return this.iam.stats(userId, request);
    await this.legacyRead(userId, request);
    await this.shadowRead(() => this.iam.stats(userId, request), request);
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

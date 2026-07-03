import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import type { Request } from "express";
import type { OAuthClient } from "@prisma/client";
import type {
  CreateOAuthClientDto,
  OAuthClientDto,
  OAuthClientReviewListQueryDto,
  OAuthClientReviewListResponseDto,
  OAuthClientWithSecretDto,
  ReviewOAuthClientDto,
  UpdateOAuthClientDto,
} from "@/api/dto/users/oauth-client.dto";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import BusinessLogService from "@/services/system/businesslog.service";
import { OAuthClientRepository } from "@/store/users/oauth-client.repository";
import type { OAuthClientStore, OAuthClientUpdateInput } from "@/store/users/oauth-client.store";
import { BadRequestError, NotFoundError } from "@/util/errors";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";

const DEFAULT_GRANT_TYPES = ["authorization_code", "refresh_token"];
const DEFAULT_SCOPES = ["profile"];
const REVIEW_STATUS = {
  DRAFT: "draft",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;

export class OAuthClientService {
  private static instance: OAuthClientService | null = null;

  private constructor(
    private readonly repository: OAuthClientStore = OAuthClientRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
  ) {}

  static getInstance(): OAuthClientService {
    if (!this.instance) this.instance = new OAuthClientService();
    return this.instance;
  }

  async createClient(userId: string, data: CreateOAuthClientDto, request?: Request): Promise<OAuthClientWithSecretDto> {
    const clientId = this.generateClientId();
    const rawClientSecret = data.clientType === "public" ? "" : this.generateClientSecret();
    const clientSecretHash = rawClientSecret ? await bcrypt.hash(rawClientSecret, 10) : undefined;

    const created = await this.repository.create({
      userId,
      name: data.name.trim(),
      description: this.normalizeOptionalText(data.description),
      clientId,
      clientSecretHash,
      clientSecretPreview: rawClientSecret ? this.buildSecretPreview(rawClientSecret) : undefined,
      clientType: data.clientType ?? "confidential",
      reviewStatus: REVIEW_STATUS.DRAFT,
      reviewComment: undefined,
      submittedAt: null,
      reviewedAt: null,
      reviewedByUserId: null,
      grantTypes: DEFAULT_GRANT_TYPES,
      redirectUris: this.normalizeStringArray(data.redirectUris),
      scopes: this.normalizeStringArray(data.scopes, DEFAULT_SCOPES),
      homepageUrl: this.normalizeOptionalText(data.homepageUrl),
      logoUrl: this.normalizeOptionalText(data.logoUrl),
      policyUrl: this.normalizeOptionalText(data.policyUrl),
      tosUrl: this.normalizeOptionalText(data.tosUrl),
      isPkceRequired: true,
      accessTokenLifetime: 3600,
      refreshTokenLifetime: 60 * 60 * 24 * 30,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.OAUTH_CLIENT_CREATE,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: created.id,
      targetResourceType: "OAUTH_CLIENT",
      description: `创建 OAuth 应用 '${created.name}'`,
      changes: {
        clientType: created.clientType,
        redirectUris: created.redirectUris,
        scopes: created.scopes,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return {
      ...this.toDto(created),
      clientSecret: rawClientSecret,
    };
  }

  async listClients(userId: string): Promise<OAuthClientDto[]> {
    const clients = await this.repository.findByUserId(userId);
    return clients.map((item) => this.toDto(item));
  }

  async getClient(id: string, userId: string): Promise<OAuthClientDto> {
    const client = await this.requireOwnedClient(id, userId);
    return this.toDto(client);
  }

  async updateClient(
    id: string,
    userId: string,
    data: UpdateOAuthClientDto,
    request?: Request,
  ): Promise<OAuthClientDto> {
    const existing = await this.requireOwnedClient(id, userId);
    const updateData: OAuthClientUpdateInput = {};

    if (Object.prototype.hasOwnProperty.call(data, "name") && data.name !== undefined)
      updateData.name = data.name.trim();
    if (Object.prototype.hasOwnProperty.call(data, "description"))
      updateData.description = this.normalizeNullableText(data.description);
    if (Object.prototype.hasOwnProperty.call(data, "redirectUris") && data.redirectUris)
      updateData.redirectUris = this.normalizeStringArray(data.redirectUris);
    if (Object.prototype.hasOwnProperty.call(data, "scopes") && data.scopes)
      updateData.scopes = this.normalizeStringArray(data.scopes, DEFAULT_SCOPES);
    if (Object.prototype.hasOwnProperty.call(data, "homepageUrl"))
      updateData.homepageUrl = this.normalizeNullableText(data.homepageUrl);
    if (Object.prototype.hasOwnProperty.call(data, "logoUrl"))
      updateData.logoUrl = this.normalizeNullableText(data.logoUrl);
    if (Object.prototype.hasOwnProperty.call(data, "policyUrl"))
      updateData.policyUrl = this.normalizeNullableText(data.policyUrl);
    if (Object.prototype.hasOwnProperty.call(data, "tosUrl"))
      updateData.tosUrl = this.normalizeNullableText(data.tosUrl);
    if (Object.prototype.hasOwnProperty.call(data, "clientType") && data.clientType)
      updateData.clientType = data.clientType;

    if (
      Object.keys(updateData).length > 0 &&
      (existing.reviewStatus === REVIEW_STATUS.APPROVED || existing.reviewStatus === REVIEW_STATUS.REJECTED)
    ) {
      updateData.reviewStatus = REVIEW_STATUS.DRAFT;
      updateData.reviewComment = null;
      updateData.submittedAt = null;
      updateData.reviewedAt = null;
      updateData.reviewedByUserId = null;
    }

    const updated = await this.repository.update(id, updateData);

    await this.businessLogService.logOperation({
      operationType: OperationType.OAUTH_CLIENT_UPDATE,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: updated.id,
      targetResourceType: "OAUTH_CLIENT",
      description: `更新 OAuth 应用 '${updated.name}'`,
      changes: {
        before: this.toDto(existing),
        after: this.toDto(updated),
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toDto(updated);
  }

  async deleteClient(id: string, userId: string, request?: Request): Promise<void> {
    const existing = await this.requireOwnedClient(id, userId);
    await this.repository.delete(id);

    await this.businessLogService.logOperation({
      operationType: OperationType.OAUTH_CLIENT_DELETE,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: existing.id,
      targetResourceType: "OAUTH_CLIENT",
      description: `删除 OAuth 应用 '${existing.name}'`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  async deleteClientForReview(id: string, reviewerUserId: string, request?: Request): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundError("OAuth client not found");

    await this.repository.delete(id);

    await this.businessLogService.logOperation({
      operationType: OperationType.OAUTH_CLIENT_DELETE,
      operationCategory: OperationCategory.AUTH,
      actorUserId: reviewerUserId,
      targetUserId: existing.userId,
      targetResourceId: existing.id,
      targetResourceType: "OAUTH_CLIENT",
      description: `审核侧删除 OAuth 应用 '${existing.name}'`,
      changes: {
        reviewStatus: existing.reviewStatus,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  async regenerateSecret(id: string, userId: string, request?: Request): Promise<OAuthClientWithSecretDto> {
    const existing = await this.requireOwnedClient(id, userId);
    if (existing.clientType === "public") throw new BadRequestError("Public OAuth client does not use client secret");

    const rawClientSecret = this.generateClientSecret();
    const updated = await this.repository.update(id, {
      clientSecretHash: await bcrypt.hash(rawClientSecret, 10),
      clientSecretPreview: this.buildSecretPreview(rawClientSecret),
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.OAUTH_CLIENT_SECRET_ROTATE,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: updated.id,
      targetResourceType: "OAUTH_CLIENT",
      description: `轮换 OAuth 应用 '${updated.name}' 的客户端密钥`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return {
      ...this.toDto(updated),
      clientSecret: rawClientSecret,
    };
  }

  async submitForReview(id: string, userId: string, request?: Request): Promise<OAuthClientDto> {
    const existing = await this.requireOwnedClient(id, userId);

    if (existing.reviewStatus === REVIEW_STATUS.PENDING)
      throw new BadRequestError("OAuth client is already pending review");

    const updated = await this.repository.update(id, {
      reviewStatus: REVIEW_STATUS.PENDING,
      submittedAt: new Date(),
      reviewComment: null,
      reviewedAt: null,
      reviewedByUserId: null,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.OAUTH_CLIENT_SUBMIT_REVIEW,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: updated.id,
      targetResourceType: "OAUTH_CLIENT",
      description: `提交 OAuth 应用 '${updated.name}' 审核`,
      changes: {
        beforeStatus: existing.reviewStatus,
        afterStatus: updated.reviewStatus,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toDto(updated);
  }

  async listClientsForReview(query: OAuthClientReviewListQueryDto): Promise<OAuthClientReviewListResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const result = await this.repository.findReviewList({
      page,
      pageSize,
      reviewStatus: query.reviewStatus,
      keyword: query.keyword?.trim() || undefined,
    });

    return {
      items: result.items.map((item) => ({
        ...this.toDto(item),
        ownerUsername: item.user.username,
        reviewerUsername: item.reviewedBy?.username ?? undefined,
      })),
      total: result.total,
      page,
      pageSize,
    };
  }

  async reviewClient(
    id: string,
    reviewerUserId: string,
    data: ReviewOAuthClientDto,
    request?: Request,
  ): Promise<OAuthClientDto> {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundError("OAuth client not found");
    if (existing.reviewStatus !== REVIEW_STATUS.PENDING)
      throw new BadRequestError("Only pending OAuth clients can be reviewed");

    const updated = await this.repository.update(id, {
      reviewStatus: data.reviewStatus,
      reviewComment: this.normalizeNullableText(data.reviewComment),
      reviewedAt: new Date(),
      reviewedByUserId: reviewerUserId,
    });

    await this.businessLogService.logOperation({
      operationType:
        data.reviewStatus === REVIEW_STATUS.APPROVED
          ? OperationType.OAUTH_CLIENT_REVIEW_APPROVE
          : OperationType.OAUTH_CLIENT_REVIEW_REJECT,
      operationCategory: OperationCategory.AUTH,
      actorUserId: reviewerUserId,
      targetUserId: existing.userId,
      targetResourceId: updated.id,
      targetResourceType: "OAUTH_CLIENT",
      description: `${data.reviewStatus === REVIEW_STATUS.APPROVED ? "通过" : "拒绝"} OAuth 应用 '${updated.name}' 审核`,
      changes: {
        beforeStatus: existing.reviewStatus,
        afterStatus: updated.reviewStatus,
        reviewComment: updated.reviewComment,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toDto(updated);
  }

  private async requireOwnedClient(id: string, userId: string): Promise<OAuthClient> {
    const client = await this.repository.findById(id);
    if (!client || client.userId !== userId) throw new NotFoundError("OAuth client not found");
    return client;
  }

  private generateClientId(): string {
    return `oauth_${randomBytes(16).toString("hex")}`;
  }

  private generateClientSecret(): string {
    return `oauths_${randomBytes(32).toString("hex")}`;
  }

  private buildSecretPreview(secret: string): string {
    return `${secret.slice(0, 9)}****${secret.slice(-4)}`;
  }

  private normalizeOptionalText(value?: string): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  }

  private normalizeNullableText(value?: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private normalizeStringArray(values?: string[], fallback: string[] = []): string[] {
    const normalized = (values ?? fallback).map((item) => item.trim()).filter(Boolean);

    if (normalized.length === 0) return [...fallback];
    return Array.from(new Set(normalized));
  }

  private readJsonStringArray(value: unknown, fallback: string[] = []): string[] {
    if (!Array.isArray(value)) return [...fallback];
    return value.filter((item): item is string => typeof item === "string");
  }

  private toDto(client: OAuthClient): OAuthClientDto {
    return {
      id: client.id,
      userId: client.userId,
      reviewerUserId: client.reviewedByUserId ?? undefined,
      name: client.name,
      description: client.description ?? undefined,
      clientId: client.clientId,
      clientSecretPreview: client.clientSecretPreview ?? undefined,
      clientType: client.clientType as OAuthClientDto["clientType"],
      reviewStatus: client.reviewStatus as OAuthClientDto["reviewStatus"],
      reviewComment: client.reviewComment ?? undefined,
      submittedAt: client.submittedAt?.toISOString(),
      reviewedAt: client.reviewedAt?.toISOString(),
      grantTypes: this.readJsonStringArray(client.grantTypes, DEFAULT_GRANT_TYPES),
      redirectUris: this.readJsonStringArray(client.redirectUris),
      scopes: this.readJsonStringArray(client.scopes, DEFAULT_SCOPES),
      homepageUrl: client.homepageUrl ?? undefined,
      logoUrl: client.logoUrl ?? undefined,
      policyUrl: client.policyUrl ?? undefined,
      tosUrl: client.tosUrl ?? undefined,
      isPkceRequired: client.isPkceRequired,
      accessTokenLifetime: client.accessTokenLifetime,
      refreshTokenLifetime: client.refreshTokenLifetime,
      lastUsedAt: client.lastUsedAt?.toISOString(),
      createTime: client.createTime.toISOString(),
      updateTime: client.updateTime.toISOString(),
      hasClientSecret: !!client.clientSecretHash,
    };
  }
}

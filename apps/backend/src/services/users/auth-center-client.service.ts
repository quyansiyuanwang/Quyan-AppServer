import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import type { Request } from "express";
import type { AuthCenterClient } from "@prisma/client";
import type {
  AuthCenterGrantType,
  AuthCenterClientDto,
  AuthCenterClientReviewListQueryDto,
  AuthCenterClientReviewListResponseDto,
  AuthCenterClientWithSecretDto,
  CreateAuthCenterClientDto,
  ReviewAuthCenterClientDto,
  UpdateAuthCenterClientDto,
} from "@/api/dto/users/auth-center-client.dto";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import BusinessLogService from "@/services/system/businesslog.service";
import { AuthCenterClientRepository } from "@/store/users/auth-center-client.repository";
import type { AuthCenterClientStore, AuthCenterClientUpdateInput } from "@/store/users/auth-center-client.store";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import { BadRequestError, NotFoundError } from "@/util/errors";

const DEFAULT_SCOPES = ["profile"];
const REVIEW_STATUS = {
  DRAFT: "draft",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;

const DEFAULT_ACCESS_TOKEN_LIFETIME = 3600;
const DEFAULT_REFRESH_TOKEN_LIFETIME = 60 * 60 * 24 * 30;

export class AuthCenterClientService {
  private static instance: AuthCenterClientService | null = null;

  private constructor(
    private readonly repository: AuthCenterClientStore = AuthCenterClientRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
  ) {}

  static getInstance(): AuthCenterClientService {
    if (!this.instance) this.instance = new AuthCenterClientService();
    return this.instance;
  }

  async createClient(
    userId: string,
    data: CreateAuthCenterClientDto,
    request?: Request,
  ): Promise<AuthCenterClientWithSecretDto> {
    const clientType = data.clientType ?? "confidential";
    const grantTypes = this.normalizeGrantTypes(data.grantTypes, clientType);
    const redirectUris = this.normalizeStringArray(data.redirectUris);
    const isPkceRequired = this.resolvePkceRequirement(clientType, grantTypes, data.isPkceRequired);

    this.validateClientSettings({
      clientType,
      grantTypes,
      redirectUris,
      isPkceRequired,
      accessTokenLifetime: data.accessTokenLifetime ?? DEFAULT_ACCESS_TOKEN_LIFETIME,
      refreshTokenLifetime: data.refreshTokenLifetime ?? DEFAULT_REFRESH_TOKEN_LIFETIME,
    });

    const clientId = this.generateClientId();
    const rawClientSecret = clientType === "public" ? "" : this.generateClientSecret();
    const clientSecretHash = rawClientSecret ? await bcrypt.hash(rawClientSecret, 10) : undefined;

    const created = await this.repository.create({
      userId,
      name: data.name.trim(),
      description: this.normalizeOptionalText(data.description),
      clientId,
      clientSecretHash,
      clientSecretPreview: rawClientSecret ? this.buildSecretPreview(rawClientSecret) : undefined,
      clientType,
      reviewStatus: REVIEW_STATUS.DRAFT,
      reviewComment: undefined,
      submittedAt: null,
      reviewedAt: null,
      reviewedByUserId: null,
      grantTypes,
      redirectUris,
      scopes: this.normalizeStringArray(data.scopes, DEFAULT_SCOPES),
      homepageUrl: this.normalizeOptionalText(data.homepageUrl),
      logoUrl: this.normalizeOptionalText(data.logoUrl),
      policyUrl: this.normalizeOptionalText(data.policyUrl),
      tosUrl: this.normalizeOptionalText(data.tosUrl),
      isPkceRequired,
      accessTokenLifetime: data.accessTokenLifetime ?? DEFAULT_ACCESS_TOKEN_LIFETIME,
      refreshTokenLifetime: data.refreshTokenLifetime ?? DEFAULT_REFRESH_TOKEN_LIFETIME,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.AUTH_CENTER_CLIENT_CREATE,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: created.id,
      targetResourceType: "AUTH_CENTER_CLIENT",
      description: `创建认证中心应用 '${created.name}'`,
      changes: {
        clientType: created.clientType,
        grantTypes: created.grantTypes,
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

  async listClients(userId: string): Promise<AuthCenterClientDto[]> {
    const clients = await this.repository.findByUserId(userId);
    return clients.map((item) => this.toDto(item));
  }

  async getClient(id: string, userId: string): Promise<AuthCenterClientDto> {
    const client = await this.requireOwnedClient(id, userId);
    return this.toDto(client);
  }

  async updateClient(
    id: string,
    userId: string,
    data: UpdateAuthCenterClientDto,
    request?: Request,
  ): Promise<AuthCenterClientDto> {
    const existing = await this.requireOwnedClient(id, userId);
    const nextClientType = data.clientType ?? existing.clientType;
    const nextGrantTypes = Object.prototype.hasOwnProperty.call(data, "grantTypes")
      ? this.normalizeGrantTypes(data.grantTypes, nextClientType)
      : (this.readJsonStringArray(existing.grantTypes) as AuthCenterGrantType[]);
    const nextRedirectUris = Object.prototype.hasOwnProperty.call(data, "redirectUris")
      ? this.normalizeStringArray(data.redirectUris)
      : this.readJsonStringArray(existing.redirectUris);
    const nextIsPkceRequired = Object.prototype.hasOwnProperty.call(data, "isPkceRequired")
      ? this.resolvePkceRequirement(nextClientType, nextGrantTypes, data.isPkceRequired)
      : this.resolvePkceRequirement(nextClientType, nextGrantTypes, existing.isPkceRequired);
    const nextAccessTokenLifetime = data.accessTokenLifetime ?? existing.accessTokenLifetime;
    const nextRefreshTokenLifetime = data.refreshTokenLifetime ?? existing.refreshTokenLifetime;

    this.validateClientSettings({
      clientType: nextClientType,
      grantTypes: nextGrantTypes,
      redirectUris: nextRedirectUris,
      isPkceRequired: nextIsPkceRequired,
      accessTokenLifetime: nextAccessTokenLifetime,
      refreshTokenLifetime: nextRefreshTokenLifetime,
    });

    const updateData: AuthCenterClientUpdateInput = {};

    if (Object.prototype.hasOwnProperty.call(data, "name") && data.name !== undefined)
      updateData.name = data.name.trim();
    if (Object.prototype.hasOwnProperty.call(data, "description"))
      updateData.description = this.normalizeNullableText(data.description);
    if (Object.prototype.hasOwnProperty.call(data, "redirectUris")) updateData.redirectUris = nextRedirectUris;
    if (Object.prototype.hasOwnProperty.call(data, "scopes"))
      updateData.scopes = this.normalizeStringArray(data.scopes, DEFAULT_SCOPES);
    if (Object.prototype.hasOwnProperty.call(data, "homepageUrl"))
      updateData.homepageUrl = this.normalizeNullableText(data.homepageUrl);
    if (Object.prototype.hasOwnProperty.call(data, "logoUrl"))
      updateData.logoUrl = this.normalizeNullableText(data.logoUrl);
    if (Object.prototype.hasOwnProperty.call(data, "policyUrl"))
      updateData.policyUrl = this.normalizeNullableText(data.policyUrl);
    if (Object.prototype.hasOwnProperty.call(data, "tosUrl"))
      updateData.tosUrl = this.normalizeNullableText(data.tosUrl);
    if (Object.prototype.hasOwnProperty.call(data, "clientType")) updateData.clientType = nextClientType;
    if (Object.prototype.hasOwnProperty.call(data, "grantTypes")) updateData.grantTypes = nextGrantTypes;
    if (Object.prototype.hasOwnProperty.call(data, "isPkceRequired")) updateData.isPkceRequired = nextIsPkceRequired;
    if (Object.prototype.hasOwnProperty.call(data, "accessTokenLifetime"))
      updateData.accessTokenLifetime = nextAccessTokenLifetime;
    if (Object.prototype.hasOwnProperty.call(data, "refreshTokenLifetime"))
      updateData.refreshTokenLifetime = nextRefreshTokenLifetime;

    if (existing.clientType !== nextClientType && nextClientType === "public") {
      updateData.clientSecretHash = null;
      updateData.clientSecretPreview = null;
    }

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
      operationType: OperationType.AUTH_CENTER_CLIENT_UPDATE,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: updated.id,
      targetResourceType: "AUTH_CENTER_CLIENT",
      description: `更新认证中心应用 '${updated.name}'`,
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
      operationType: OperationType.AUTH_CENTER_CLIENT_DELETE,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: existing.id,
      targetResourceType: "AUTH_CENTER_CLIENT",
      description: `删除认证中心应用 '${existing.name}'`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  async deleteClientForReview(id: string, reviewerUserId: string, request?: Request): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundError("Auth Center client not found");

    await this.repository.delete(id);

    await this.businessLogService.logOperation({
      operationType: OperationType.AUTH_CENTER_CLIENT_DELETE,
      operationCategory: OperationCategory.AUTH,
      actorUserId: reviewerUserId,
      targetUserId: existing.userId,
      targetResourceId: existing.id,
      targetResourceType: "AUTH_CENTER_CLIENT",
      description: `审核侧删除认证中心应用 '${existing.name}'`,
      changes: {
        reviewStatus: existing.reviewStatus,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  async regenerateSecret(id: string, userId: string, request?: Request): Promise<AuthCenterClientWithSecretDto> {
    const existing = await this.requireOwnedClient(id, userId);
    if (existing.clientType === "public")
      throw new BadRequestError("Public Auth Center client does not use client secret");

    const rawClientSecret = this.generateClientSecret();
    const updated = await this.repository.update(id, {
      clientSecretHash: await bcrypt.hash(rawClientSecret, 10),
      clientSecretPreview: this.buildSecretPreview(rawClientSecret),
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.AUTH_CENTER_CLIENT_SECRET_ROTATE,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: updated.id,
      targetResourceType: "AUTH_CENTER_CLIENT",
      description: `轮换认证中心应用 '${updated.name}' 的客户端密钥`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return {
      ...this.toDto(updated),
      clientSecret: rawClientSecret,
    };
  }

  async submitForReview(id: string, userId: string, request?: Request): Promise<AuthCenterClientDto> {
    const existing = await this.requireOwnedClient(id, userId);

    if (existing.reviewStatus === REVIEW_STATUS.PENDING)
      throw new BadRequestError("Auth Center client is already pending review");

    const updated = await this.repository.update(id, {
      reviewStatus: REVIEW_STATUS.PENDING,
      submittedAt: new Date(),
      reviewComment: null,
      reviewedAt: null,
      reviewedByUserId: null,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.AUTH_CENTER_CLIENT_SUBMIT_REVIEW,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: updated.id,
      targetResourceType: "AUTH_CENTER_CLIENT",
      description: `提交认证中心应用 '${updated.name}' 审核`,
      changes: {
        beforeStatus: existing.reviewStatus,
        afterStatus: updated.reviewStatus,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toDto(updated);
  }

  async listClientsForReview(
    query: AuthCenterClientReviewListQueryDto,
  ): Promise<AuthCenterClientReviewListResponseDto> {
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
    data: ReviewAuthCenterClientDto,
    request?: Request,
  ): Promise<AuthCenterClientDto> {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundError("Auth Center client not found");
    if (existing.reviewStatus !== REVIEW_STATUS.PENDING)
      throw new BadRequestError("Only pending Auth Center clients can be reviewed");

    const updated = await this.repository.update(id, {
      reviewStatus: data.reviewStatus,
      reviewComment: this.normalizeNullableText(data.reviewComment),
      reviewedAt: new Date(),
      reviewedByUserId: reviewerUserId,
    });

    await this.businessLogService.logOperation({
      operationType:
        data.reviewStatus === REVIEW_STATUS.APPROVED
          ? OperationType.AUTH_CENTER_CLIENT_REVIEW_APPROVE
          : OperationType.AUTH_CENTER_CLIENT_REVIEW_REJECT,
      operationCategory: OperationCategory.AUTH,
      actorUserId: reviewerUserId,
      targetUserId: existing.userId,
      targetResourceId: updated.id,
      targetResourceType: "AUTH_CENTER_CLIENT",
      description: `${data.reviewStatus === REVIEW_STATUS.APPROVED ? "通过" : "拒绝"}认证中心应用 '${updated.name}' 审核`,
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

  private async requireOwnedClient(id: string, userId: string): Promise<AuthCenterClient> {
    const client = await this.repository.findById(id);
    if (!client || client.userId !== userId) throw new NotFoundError("Auth Center client not found");
    return client;
  }

  private validateClientSettings(input: {
    clientType: string;
    grantTypes: string[];
    redirectUris: string[];
    isPkceRequired: boolean;
    accessTokenLifetime: number;
    refreshTokenLifetime: number;
  }): void {
    if (input.grantTypes.includes("refresh_token") && !input.grantTypes.includes("authorization_code"))
      throw new BadRequestError("refresh_token grant requires authorization_code grant");

    if (input.grantTypes.includes("authorization_code") && input.redirectUris.length === 0)
      throw new BadRequestError("authorization_code grant requires at least one redirect URI");

    if (input.clientType === "public" && input.grantTypes.includes("client_credentials"))
      throw new BadRequestError("Public Auth Center client cannot enable client_credentials grant");

    if (input.clientType === "public" && input.grantTypes.includes("authorization_code") && !input.isPkceRequired)
      throw new BadRequestError("Public Auth Center client must enable PKCE for authorization_code grant");

    if (input.refreshTokenLifetime < input.accessTokenLifetime)
      throw new BadRequestError("refreshTokenLifetime must be greater than or equal to accessTokenLifetime");
  }

  private normalizeGrantTypes(values: string[] | undefined, clientType: string): AuthCenterGrantType[] {
    const fallback =
      clientType === "public"
        ? (["authorization_code", "refresh_token"] as AuthCenterGrantType[])
        : (["authorization_code", "refresh_token", "client_credentials"] as AuthCenterGrantType[]);

    const normalized = Array.from(
      new Set((values ?? fallback).map((item) => item.trim()).filter(Boolean)),
    ) as AuthCenterGrantType[];

    return normalized.length > 0 ? normalized : fallback;
  }

  private resolvePkceRequirement(clientType: string, grantTypes: string[], requested?: boolean): boolean {
    if (clientType === "public" && grantTypes.includes("authorization_code")) return true;
    return requested ?? grantTypes.includes("authorization_code");
  }

  private generateClientId(): string {
    return `atc_${randomBytes(16).toString("hex")}`;
  }

  private generateClientSecret(): string {
    return `atcs_${randomBytes(32).toString("hex")}`;
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
    return Array.from(new Set(normalized));
  }

  private readJsonStringArray(value: unknown, fallback: string[] = []): string[] {
    if (!Array.isArray(value)) return [...fallback];
    return value.filter((item): item is string => typeof item === "string");
  }

  private toDto(client: AuthCenterClient): AuthCenterClientDto {
    return {
      id: client.id,
      userId: client.userId,
      reviewerUserId: client.reviewedByUserId ?? undefined,
      name: client.name,
      description: client.description ?? undefined,
      clientId: client.clientId,
      clientSecretPreview: client.clientSecretPreview ?? undefined,
      clientType: client.clientType as AuthCenterClientDto["clientType"],
      reviewStatus: client.reviewStatus as AuthCenterClientDto["reviewStatus"],
      reviewComment: client.reviewComment ?? undefined,
      submittedAt: client.submittedAt?.toISOString(),
      reviewedAt: client.reviewedAt?.toISOString(),
      grantTypes: this.readJsonStringArray(client.grantTypes) as AuthCenterClientDto["grantTypes"],
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

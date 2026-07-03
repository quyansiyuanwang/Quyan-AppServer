import type { Request } from "express";
import { Prisma, type LegalPolicyVersion } from "@prisma/client";
import { LEGAL_POLICY_TYPES, LegalPolicyPublishStatus, type LegalPolicyType } from "@/constant/legal-policy";
import { CustomCode } from "@/constant/custom-code";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import type {
  CreateLegalPolicyDto,
  CurrentLegalPoliciesResponse,
  LegalPolicyDto,
  LegalPolicyListItemDto,
  PublicLegalPolicyDto,
  UpdateLegalPolicyDto,
} from "@/api/dto/legal-policy/legal-policy.dto";
import { LegalPolicyRepository } from "@/store/content/legal-policy.repository";
import type { LegalPolicyStore } from "@/store/content/legal-policy.store";
import { UserRepository } from "@/store/users/user.repository";
import type { UserStore } from "@/store/users/user.store";
import BusinessLogService from "@/services/system/businesslog.service";
import { BadRequestError, ConflictError, NotFoundError } from "@/util/errors";
import { extractClientIp } from "@/util/ip-extractor";

export class LegalPolicyService {
  private static instance: LegalPolicyService;

  private constructor(
    private readonly repository: LegalPolicyStore = LegalPolicyRepository.getInstance(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
  ) {}

  public static getInstance(): LegalPolicyService {
    if (!LegalPolicyService.instance) LegalPolicyService.instance = new LegalPolicyService();

    return LegalPolicyService.instance;
  }

  public async createPolicy(dto: CreateLegalPolicyDto, actorUserId: string, request: Request): Promise<LegalPolicyDto> {
    const policy = await this.createDraftPolicy(dto, actorUserId);

    await this.businessLogService.logOperation({
      operationType: OperationType.LEGAL_POLICY_CREATE,
      operationCategory: OperationCategory.LEGAL_POLICY,
      actorUserId,
      targetResourceId: policy.id,
      targetResourceType: "LegalPolicyVersion",
      description: `创建法律协议草稿：${dto.policyType} v${policy.version}`,
      metadata: { policyType: dto.policyType, version: policy.version },
      success: true,
      requestId: request.headers["x-request-id"] as string | undefined,
      ipAddress: extractClientIp(request),
      userAgent: request.headers["user-agent"],
    });

    return this.toLegalPolicyDto(policy);
  }

  public async listPolicies(policyType?: LegalPolicyType): Promise<LegalPolicyListItemDto[]> {
    const policies = await this.repository.findAll({ policyType });
    return Promise.all(policies.map((policy) => this.toLegalPolicyListItemDto(policy)));
  }

  public async getPolicy(id: string): Promise<LegalPolicyDto> {
    const policy = await this.repository.findById(id);
    if (!policy) throw new NotFoundError("法律协议版本不存在");

    return this.toLegalPolicyDto(policy);
  }

  public async updatePolicy(
    id: string,
    dto: UpdateLegalPolicyDto,
    actorUserId: string,
    request: Request,
  ): Promise<LegalPolicyDto> {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundError("法律协议版本不存在");
    if (existing.publishStatus !== LegalPolicyPublishStatus.DRAFT)
      throw new BadRequestError("已发布的协议版本不允许修改，请新建版本");

    const updated = await this.repository.update(id, {
      ...dto,
      updatedBy: actorUserId,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.LEGAL_POLICY_UPDATE,
      operationCategory: OperationCategory.LEGAL_POLICY,
      actorUserId,
      targetResourceId: updated.id,
      targetResourceType: "LegalPolicyVersion",
      description: `更新法律协议草稿：${updated.policyType} v${updated.version}`,
      changes: dto,
      success: true,
      requestId: request.headers["x-request-id"] as string | undefined,
      ipAddress: extractClientIp(request),
      userAgent: request.headers["user-agent"],
    });

    return this.toLegalPolicyDto(updated);
  }

  public async deletePolicy(id: string, actorUserId: string, request: Request): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundError("法律协议版本不存在");
    if (existing.publishStatus !== LegalPolicyPublishStatus.DRAFT)
      throw new BadRequestError("已发布的协议版本不允许删除");

    await this.repository.delete(id);

    await this.businessLogService.logOperation({
      operationType: OperationType.LEGAL_POLICY_DELETE,
      operationCategory: OperationCategory.LEGAL_POLICY,
      actorUserId,
      targetResourceId: existing.id,
      targetResourceType: "LegalPolicyVersion",
      description: `删除法律协议草稿：${existing.policyType} v${existing.version}`,
      success: true,
      requestId: request.headers["x-request-id"] as string | undefined,
      ipAddress: extractClientIp(request),
      userAgent: request.headers["user-agent"],
    });
  }

  public async publishPolicy(id: string, actorUserId: string, request: Request): Promise<LegalPolicyDto> {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundError("法律协议版本不存在");
    if (existing.publishStatus === LegalPolicyPublishStatus.PUBLISHED) throw new BadRequestError("该协议版本已发布");

    const policyType = existing.policyType as LegalPolicyType;

    const published = await this.repository.publishVersion(id, policyType);
    const updated = await this.repository.update(published.id, {
      updatedBy: actorUserId,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.LEGAL_POLICY_PUBLISH,
      operationCategory: OperationCategory.LEGAL_POLICY,
      actorUserId,
      targetResourceId: updated.id,
      targetResourceType: "LegalPolicyVersion",
      description: `发布法律协议版本：${updated.policyType} v${updated.version}`,
      metadata: { policyType: updated.policyType, version: updated.version },
      success: true,
      requestId: request.headers["x-request-id"] as string | undefined,
      ipAddress: extractClientIp(request),
      userAgent: request.headers["user-agent"],
    });

    return this.toLegalPolicyDto(updated);
  }

  public async unpublishPolicy(id: string, actorUserId: string, request: Request): Promise<LegalPolicyDto> {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundError("法律协议版本不存在");
    if (existing.publishStatus !== LegalPolicyPublishStatus.PUBLISHED)
      throw new BadRequestError("该协议版本尚未发布，无需撤销发布");

    const policyType = existing.policyType as LegalPolicyType;

    let fallbackCurrentId: string | undefined;
    if (existing.isCurrent) {
      const fallback = await this.repository.findLatestPublishedVersionByPolicyType(policyType, existing.id);
      if (!fallback) throw new BadRequestError("撤销后将导致当前协议类型无有效协议，无法执行撤销发布");
      fallbackCurrentId = fallback.id;
    }

    const unpublished = await this.repository.unpublishVersion(id, policyType, fallbackCurrentId);
    const updated = await this.repository.update(unpublished.id, {
      updatedBy: actorUserId,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.LEGAL_POLICY_UNPUBLISH,
      operationCategory: OperationCategory.LEGAL_POLICY,
      actorUserId,
      targetResourceId: updated.id,
      targetResourceType: "LegalPolicyVersion",
      description: `撤销发布法律协议版本：${updated.policyType} v${updated.version}`,
      metadata: {
        policyType: updated.policyType,
        version: updated.version,
        fallbackCurrentId,
      },
      success: true,
      requestId: request.headers["x-request-id"] as string | undefined,
      ipAddress: extractClientIp(request),
      userAgent: request.headers["user-agent"],
    });

    return this.toLegalPolicyDto(updated);
  }

  public async getCurrentPolicies(policyType?: LegalPolicyType): Promise<CurrentLegalPoliciesResponse> {
    const requestedTypes = policyType ? [policyType] : LEGAL_POLICY_TYPES;
    const policies = await this.repository.findCurrentPublishedByPolicyTypes(requestedTypes);

    if (policyType) {
      if (policies.length === 0) throw new NotFoundError("当前已发布协议不存在");
    } else {
      const foundTypes = new Set(policies.map((item) => item.policyType as LegalPolicyType));
      const missingTypes = LEGAL_POLICY_TYPES.filter((type) => !foundTypes.has(type));
      if (missingTypes.length > 0) throw new NotFoundError("当前服务协议或隐私政策尚未完整发布");
    }

    return {
      policies: policies.map((policy) => this.toPublicLegalPolicyDto(policy)),
    };
  }

  public async getCurrentPublishedPolicyEntities(): Promise<LegalPolicyVersion[]> {
    const policies = await this.repository.findCurrentPublishedByPolicyTypes(LEGAL_POLICY_TYPES);
    const foundTypes = new Set(policies.map((item) => item.policyType as LegalPolicyType));
    const missingTypes = LEGAL_POLICY_TYPES.filter((type) => !foundTypes.has(type));
    if (missingTypes.length > 0) throw new NotFoundError("当前服务协议或隐私政策尚未完整发布");

    return policies;
  }

  private async toLegalPolicyDto(policy: LegalPolicyVersion): Promise<LegalPolicyDto> {
    const [creator, updater] = await Promise.all([
      this.userRepository.findById(policy.createdBy),
      policy.updatedBy ? this.userRepository.findById(policy.updatedBy) : Promise.resolve(null),
    ]);

    return {
      id: policy.id,
      policyType: policy.policyType as LegalPolicyType,
      version: policy.version,
      title: policy.title,
      summary: policy.summary ?? undefined,
      content: policy.content,
      contentFormat: policy.contentFormat,
      publishStatus: policy.publishStatus,
      isCurrent: policy.isCurrent,
      publishedAt: policy.publishedAt?.toISOString(),
      createdBy: policy.createdBy,
      createdByName: creator?.name ?? creator?.username ?? undefined,
      updatedBy: policy.updatedBy ?? undefined,
      updatedByName: updater?.name ?? updater?.username ?? undefined,
      createTime: policy.createTime.toISOString(),
      updateTime: policy.updateTime.toISOString(),
    };
  }

  private async toLegalPolicyListItemDto(policy: LegalPolicyVersion): Promise<LegalPolicyListItemDto> {
    const [creator, updater] = await Promise.all([
      this.userRepository.findById(policy.createdBy),
      policy.updatedBy ? this.userRepository.findById(policy.updatedBy) : Promise.resolve(null),
    ]);

    return {
      id: policy.id,
      policyType: policy.policyType as LegalPolicyType,
      version: policy.version,
      title: policy.title,
      summary: policy.summary ?? undefined,
      publishStatus: policy.publishStatus,
      isCurrent: policy.isCurrent,
      publishedAt: policy.publishedAt?.toISOString(),
      createdByName: creator?.name ?? creator?.username ?? undefined,
      updatedByName: updater?.name ?? updater?.username ?? undefined,
      createTime: policy.createTime.toISOString(),
      updateTime: policy.updateTime.toISOString(),
    };
  }

  private toPublicLegalPolicyDto(policy: LegalPolicyVersion): PublicLegalPolicyDto {
    return {
      id: policy.id,
      policyType: policy.policyType as LegalPolicyType,
      version: policy.version,
      title: policy.title,
      summary: policy.summary ?? undefined,
      content: policy.content,
      contentFormat: policy.contentFormat,
      publishedAt: policy.publishedAt?.toISOString(),
      updateTime: policy.updateTime.toISOString(),
    };
  }

  private async createDraftPolicy(dto: CreateLegalPolicyDto, actorUserId: string): Promise<LegalPolicyVersion> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const existingDraft = await this.repository.findDraftByPolicyType(dto.policyType);
      if (existingDraft) throw new BadRequestError("当前协议类型已有未发布草稿，请先更新或发布现有草稿");

      const latest = await this.repository.findLatestVersionByPolicyType(dto.policyType);
      const nextVersion = (latest?.version ?? 0) + 1;

      try {
        return await this.repository.create({
          policyType: dto.policyType,
          version: nextVersion,
          title: dto.title,
          summary: dto.summary,
          content: dto.content,
          contentFormat: "markdown",
          publishStatus: LegalPolicyPublishStatus.DRAFT,
          isCurrent: false,
          createdBy: actorUserId,
          updatedBy: actorUserId,
        });
      } catch (error) {
        if (this.isPolicyVersionUniqueConflict(error)) continue;
        throw error;
      }
    }

    throw new ConflictError("创建协议版本冲突，请刷新后重试", CustomCode.LEGAL_POLICY_VERSION_CONFLICT);
  }

  private isPolicyVersionUniqueConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;

    const target = Array.isArray(error.meta?.target) ? error.meta.target.join("_") : String(error.meta?.target ?? "");

    return (
      target.includes("legal_policy_versions_policyType_version_key") ||
      (target.includes("policyType") && target.includes("version"))
    );
  }
}

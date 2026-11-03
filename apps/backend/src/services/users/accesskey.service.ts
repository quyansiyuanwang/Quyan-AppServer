import { getAccessKeyIssuanceState } from "@/iam/request/accesskey-issuance-context";
import { accessKeyAuthorizationDenied } from "@/store/users/accesskey-management.repository";
import { env } from "@/config/env";
import { PermissionService } from "./permission.service";
import { Permission } from "@/constant/permission";
import { AccessKeyManagementRepository } from "@/store/users/accesskey-management.repository";
import { iamManagementPaginationSchema } from "@/iam/management-pagination";
import { AccessKeyIamService } from "./accesskey-iam.service";
import type { TypedRequest } from "@/types/express";
import { getLogger, LogCategory } from "@/util/logger";
import { randomBytes } from "crypto";
import { AccessKeyRepository } from "@/store/users/accesskey.repository";
import { UserRepository } from "@/store/users/user.repository";
import type { AccessKeyStore } from "@/store/users/accesskey.store";
import type { UserStore } from "@/store/users/user.store";
import type { CreateAccessKeyDto, AccessKeyDto, AccessKeyPageDto } from "@/api/dto/users/accesskey.dto";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { NotFoundError, UnauthorizedError, BadRequestError, ForbiddenError } from "@/util/errors";
import { EmailService } from "@/services/auth/email.service";
import { CustomCode } from "@/constant/custom-code";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import { MANAGED_STATUS } from "@/constant/status";
import { getCredentialPrefix, isValidCredential, maskSecret, toCanonicalCredential } from "@quyan/shared";
import type { Request } from "express";

export class AccessKeyService {
  constructor(
    private readonly repository: AccessKeyStore = AccessKeyRepository.getInstance(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly emailService: EmailService = EmailService.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly management = AccessKeyManagementRepository.getInstance(),
    private readonly iam = AccessKeyIamService.getInstance(),
  ) {}

  private async issuanceState(
    userId: string,
    action: "quyan:ram:CreateAccessKey" | "quyan:ram:SendAccessKeyCreationVerificationCode",
    request: TypedRequest,
  ) {
    const state = getAccessKeyIssuanceState(request);
    if (state.principal.subjectUserId !== userId || state.snapshot.id !== userId) throw accessKeyAuthorizationDenied();
    if (env.security.iamAuthorizationMode !== "enforce") {
      const permission = await PermissionService.getInstance().checkUserPermissions(
        userId,
        [Permission.ACCESSKEY_CREATE],
        { assumedRoleSessionId: state.principal.roleSessionId },
      );
      if (!permission.hasPermission) throw accessKeyAuthorizationDenied();
    }
    if (env.security.iamAuthorizationMode === "enforce") await this.iam.authorizeIssuance(userId, action, request);
    else if (env.security.iamAuthorizationMode === "shadow") {
      try {
        await this.iam.authorizeIssuance(userId, action, request, true);
      } catch {
        getLogger("AccessKeyIamBridge", LogCategory.SECURITY).warn("Access key IAM shadow evaluation denied", {
          action,
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    }
    await this.management.checkIssuanceState(state);
    return state;
  }

  async generateKeyForUser(userId: string, data: CreateAccessKeyDto, request?: Request): Promise<AccessKeyDto> {
    if (request) {
      const state = await this.issuanceState(userId, "quyan:ram:CreateAccessKey", request as TypedRequest);
      const key = `${getCredentialPrefix("accessKey")}${randomBytes(32).toString("hex")}`;
      const accessKey = await this.management.issue(
        state,
        { userId, key, name: data.name, expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined },
        data.verificationCode,
      );
      await this.logCreation(accessKey.id, userId, request);
      return this.toDto(accessKey, false);
    }
    if (env.security.iamAuthorizationMode === "enforce") throw accessKeyAuthorizationDenied();
    const user = await this.userRepository.findById(userId);
    if (!user || !user.email)
      throw new NotFoundError("用户邮箱不存在", undefined, { messageKey: "user.emailNotFound" });

    return this.generateKey(userId, user.email, data, user.twoFactorEnabled === true, request);
  }

  private async generateKey(
    userId: string,
    userEmail: string,
    data: CreateAccessKeyDto,
    skipEmailVerification: boolean = false,
    request?: Request,
  ): Promise<AccessKeyDto> {
    if (!skipEmailVerification) {
      const verificationCode = data.verificationCode?.trim();
      if (!verificationCode)
        throw new BadRequestError("验证码无效或已过期", CustomCode.VERIFICATION_CODE_INVALID, {
          messageKey: "errors.verificationCodeInvalid",
        });

      const codeValid = await this.emailService.verifyCode(userEmail, verificationCode);
      if (!codeValid)
        throw new BadRequestError("验证码无效或已过期", CustomCode.VERIFICATION_CODE_INVALID, {
          messageKey: "errors.verificationCodeInvalid",
        });
    }

    const key = `${getCredentialPrefix("accessKey")}${randomBytes(32).toString("hex")}`;
    const accessKey = await this.repository.create({
      userId,
      key,
      name: data.name,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
    });

    await this.logCreation(accessKey.id, userId, request);

    return this.toDto(accessKey, false); // 创建时返回完整密钥
  }

  private async logCreation(keyId: string, userId: string, request?: Request) {
    await this.businessLogService.logOperation({
      operationType: OperationType.ACCESS_KEY_CREATE,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: keyId,
      targetResourceType: "ACCESS_KEY",
      description: "Created an access key",
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  async validateKey(key: string): Promise<AccessKeyDto> {
    if (!isValidCredential(key, "accessKey"))
      throw new UnauthorizedError("Invalid AccessKey", undefined, { messageKey: "accessKey.invalid" });
    const accessKey = await this.repository.findByKey(key);
    if (!accessKey || accessKey.status !== MANAGED_STATUS.ENABLED)
      throw new UnauthorizedError("Invalid AccessKey", undefined, { messageKey: "accessKey.invalid" });

    if (accessKey.expiresAt && accessKey.expiresAt < new Date())
      throw new UnauthorizedError("AccessKey expired", undefined, { messageKey: "accessKey.expired" });

    return this.toDto({ ...accessKey, key: toCanonicalCredential(accessKey.key, "accessKey") });
  }

  async updateUsage(keyId: string): Promise<void> {
    await this.repository.update(keyId, {
      requestCount: { increment: 1 } as any,
      lastUsedAt: new Date(),
    });
  }

  private async assertLegacyRead(userId: string, request?: TypedRequest) {
    const result = await PermissionService.getInstance().checkUserPermissions(userId, [Permission.ACCESSKEY_READ], {
      assumedRoleSessionId: request?.user?.roleSessionId,
    });
    if (!result.hasPermission)
      throw new ForbiddenError("Legacy access key listing denied", undefined, {
        messageKey: "permission.insufficientPermission",
      });
  }
  private async compareShadow(legacy: readonly AccessKeyDto[], evaluate: () => Promise<readonly AccessKeyDto[]>) {
    if (env.security.iamAuthorizationMode !== "shadow") return;
    try {
      const rows = await evaluate();
      const ids = new Set(rows.map((row) => row.id));
      if (rows.length !== legacy.length || legacy.some((row) => !ids.has(row.id)))
        getLogger("AccessKeyIamBridge", LogCategory.SECURITY).warn("Access key IAM list differs from legacy", {
          action: "quyan:ram:ListAccessKeys",
          legacyCount: legacy.length,
          iamCount: rows.length,
        });
    } catch {
      getLogger("AccessKeyIamBridge", LogCategory.SECURITY).warn("Access key IAM shadow list unavailable", {
        action: "quyan:ram:ListAccessKeys",
        reason: "iam-list-unavailable",
      });
    }
  }
  async listKeys(userId: string, request?: TypedRequest): Promise<AccessKeyDto[]> {
    if (env.security.iamAuthorizationMode === "enforce") return AccessKeyIamService.getInstance().list(userId, request);
    await this.assertLegacyRead(userId, request);
    const keys = await this.repository.findByUserId(userId);
    const rows = keys.map((key) => this.toDto(key, true));
    await this.compareShadow(rows, () => AccessKeyIamService.getInstance().list(userId, request, true));
    return rows;
  }
  async listKeysPage(
    userId: string,
    options: { page?: number; pageSize?: number },
    request?: TypedRequest,
  ): Promise<AccessKeyPageDto> {
    const parsed = iamManagementPaginationSchema.safeParse(options);
    if (!parsed.success)
      throw new BadRequestError("Invalid access key page", undefined, {
        messageKey: "validation.fieldInvalidValue",
        messageParams: { field: "pagination" },
      });
    const page = parsed.data;
    if (env.security.iamAuthorizationMode === "enforce")
      return AccessKeyIamService.getInstance().listPage(userId, page, request);
    await this.assertLegacyRead(userId, request);
    const result = await AccessKeyManagementRepository.getInstance().legacyPage(userId, page);
    await this.compareShadow(
      result.items,
      async () => (await AccessKeyIamService.getInstance().listPage(userId, page, request, true)).items,
    );
    return result;
  }

  async revokeKey(keyId: string, userId: string, request?: Request): Promise<void> {
    if (env.security.iamAuthorizationMode === "enforce") {
      const target = await AccessKeyIamService.getInstance().revoke(userId, keyId, request as TypedRequest | undefined);
      await this.logRevocation(target.id, userId, request);
      return;
    }
    if (env.security.iamAuthorizationMode === "shadow") {
      try {
        await AccessKeyIamService.getInstance().authorizeRevocation(
          userId,
          keyId,
          request as TypedRequest | undefined,
          true,
        );
      } catch {
        getLogger("AccessKeyIamBridge", LogCategory.SECURITY).warn("Access key IAM shadow evaluation denied", {
          action: "quyan:ram:DeleteAccessKey",
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    }
    const accessKey = await this.repository.findById(keyId);
    if (!accessKey || accessKey.userId !== userId)
      throw new NotFoundError("AccessKey not found", undefined, { messageKey: "accessKey.notFound" });

    await this.repository.delete(keyId, userId);
    await this.logRevocation(accessKey.id, userId, request);
  }

  private async logRevocation(keyId: string, userId: string, request?: Request) {
    await this.businessLogService.logOperation({
      operationType: OperationType.ACCESS_KEY_DELETE,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: keyId,
      targetResourceType: "ACCESS_KEY",
      description: "Revoked an access key",
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  private async sendAccessKeyCreationVerificationCode(email: string): Promise<void> {
    await this.emailService.sendVerificationCode(email);
  }

  async sendAccessKeyCreationVerificationCodeForUser(userId: string, request?: Request): Promise<boolean> {
    if (request) {
      const state = await this.issuanceState(
        userId,
        "quyan:ram:SendAccessKeyCreationVerificationCode",
        request as TypedRequest,
      );
      if (state.snapshot.twoFactorEnabled) return false;
      // SMTP is external I/O, never held inside a credential-insertion transaction.
      // Recheck the exact authenticated state immediately before dispatch and afterwards.
      await this.management.checkIssuanceState(state);
      await this.emailService.sendVerificationCode(state.snapshot.email!);
      await this.management.checkIssuanceState(state);
      return true;
    }
    if (env.security.iamAuthorizationMode === "enforce") throw accessKeyAuthorizationDenied();
    const user = await this.userRepository.findById(userId);
    if (!user || !user.email)
      throw new NotFoundError("用户邮箱不存在", undefined, { messageKey: "user.emailNotFound" });

    if (user.twoFactorEnabled) return false;

    await this.sendAccessKeyCreationVerificationCode(user.email);
    return true;
  }

  private toDto(accessKey: any, maskKey: boolean = true): AccessKeyDto {
    return {
      id: accessKey.id,
      userId: accessKey.userId,
      name: accessKey.name,
      key: maskKey
        ? maskSecret(toCanonicalCredential(accessKey.key, "accessKey"))
        : toCanonicalCredential(accessKey.key, "accessKey"),
      expiresAt: accessKey.expiresAt,
      lastUsedAt: accessKey.lastUsedAt,
      requestCount: accessKey.requestCount,
      createTime: accessKey.createTime,
    };
  }
}

import { env } from "@/config/env";
import { AccessKeyIamService } from "./accesskey-iam.service";
import type { TypedRequest } from "@/types/express";
import { getLogger, LogCategory } from "@/util/logger";
import { randomBytes } from "crypto";
import { AccessKeyRepository } from "@/store/users/accesskey.repository";
import { UserRepository } from "@/store/users/user.repository";
import type { AccessKeyStore } from "@/store/users/accesskey.store";
import type { UserStore } from "@/store/users/user.store";
import type { CreateAccessKeyDto, AccessKeyDto } from "@/api/dto/users/accesskey.dto";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { NotFoundError, UnauthorizedError, BadRequestError } from "@/util/errors";
import { EmailService } from "@/services/auth/email.service";
import { CustomCode } from "@/constant/custom-code";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import { MANAGED_STATUS } from "@/constant/status";
import { getCredentialPrefix, maskSecret, toCanonicalCredential } from "@quyan/shared";
import type { Request } from "express";

export class AccessKeyService {
  constructor(
    private readonly repository: AccessKeyStore = AccessKeyRepository.getInstance(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly emailService: EmailService = EmailService.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
  ) {}

  async generateKeyForUser(userId: string, data: CreateAccessKeyDto, request?: Request): Promise<AccessKeyDto> {
    const user = await this.userRepository.findById(userId);
    if (!user || !user.email)
      throw new NotFoundError("用户邮箱不存在", undefined, { messageKey: "user.emailNotFound" });

    return this.generateKey(userId, user.email, data, user.twoFactorEnabled === true, request);
  }

  async generateKey(
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

    await this.businessLogService.logOperation({
      operationType: OperationType.ACCESS_KEY_CREATE,
      operationCategory: OperationCategory.AUTH,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: accessKey.id,
      targetResourceType: "ACCESS_KEY",
      description: `创建了 AccessKey '${accessKey.name || accessKey.id}'`,
      changes: {
        name: accessKey.name,
        expiresAt: accessKey.expiresAt,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toDto(accessKey, false); // 创建时返回完整密钥
  }

  async validateKey(key: string): Promise<AccessKeyDto> {
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

  async listKeys(userId: string): Promise<AccessKeyDto[]> {
    const keys = await this.repository.findByUserId(userId);
    return keys.map((k) => this.toDto(k, true)); // 列表中掩码密钥
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

  async sendAccessKeyCreationVerificationCode(email: string): Promise<void> {
    await this.emailService.sendVerificationCode(email);
  }

  async sendAccessKeyCreationVerificationCodeForUser(userId: string): Promise<boolean> {
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

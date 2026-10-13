import { USER_EMAIL_CHANGE_WINDOW_MS } from "@/constant/user-email";
import { Permission, CustomCode, getOAuthScopeAliases } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import {
  UserProfileManagementRepository,
  userProfileAuthorizationDenied,
  type UserProfileIdentity,
} from "@/store/users/user-profile-management.repository";
import { UserRepository } from "@/store/users/user.repository";
import { BusinessLogRepository } from "@/store/system/businesslog";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { EmailService } from "@/services/auth/email.service";
import { PermissionService } from "./permission.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import { extractClientIp } from "@/util/ip-extractor";
import type { TypedRequest } from "@/types/express";
import type { ChangeEmailDto } from "@/api/dto/users/user.dto";
import { changeEmailBodySchema, sendEmailChangeCodeBodySchema } from "@/api/schema/users/user.schema";
const permission = Permission.USER_UPDATE_SELF_EMAIL;
type EmailAction = "quyan:user:SendEmailChangeCode" | "quyan:user:ChangeEmail";
export class UserEmailIamService {
  private static instance: UserEmailIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorize"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: Pick<
      UserProfileManagementRepository,
      "emailSnapshot" | "recheckEmail" | "updateEmail"
    > = UserProfileManagementRepository.getInstance(),
    private readonly userRepository: Pick<
      UserRepository,
      "findById" | "findByEmailInNonDeleted"
    > = UserRepository.getInstance(),
    private readonly businessLogRepository: Pick<
      BusinessLogRepository,
      "findRecentSuccessfulOperation"
    > = BusinessLogRepository.getInstance(),
    private readonly businessLogService: Pick<BusinessLogService, "logOperation"> = BusinessLogService.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new UserEmailIamService());
  }
  private async prepare(userId: string, request: TypedRequest | undefined, action: EmailAction) {
    const principal = request && getIamPrincipal(request),
      oauth = request?.oauthAccessToken,
      mode = env.security.iamAuthorizationMode;
    if (
      !request ||
      !principal ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(userId) ||
      principal.subjectUserId !== userId ||
      principal.principalUserId !== userId ||
      (oauth &&
        (oauth.userId !== userId || !getOAuthScopeAliases("email").some((scope) => oauth.scopes.includes(scope)))) ||
      !["legacy", "shadow", "enforce"].includes(mode)
    )
      throw userProfileAuthorizationDenied();
    if (request.user?.impersonatorId && request.user.impersonationMode === "view")
      throw new ForbiddenError(
        "Read-only impersonation cannot change email",
        CustomCode.IMPERSONATION_READONLY_VIOLATION,
        { messageKey: "errors.impersonationReadonlyViolation" },
      );
    const identity: UserProfileIdentity = {
      principal: { ...principal },
      ...(oauth ? { oauth: { id: oauth.id, clientId: oauth.oauthClientId, scope: "email" } } : {}),
    };
    const snapshot = await this.repository.emailSnapshot(identity);
    if (mode !== "enforce") {
      const result = await this.permissions.checkUserPermissions(userId, [permission], {
        assumedRoleSessionId: principal.roleSessionId,
      });
      if (!result.hasPermission) throw userProfileAuthorizationDenied();
    }
    let initialPolicies: string | undefined;
    const recheck = async () => {
      if (mode === "legacy") {
        const result = await this.permissions.checkUserPermissions(userId, [permission], {
          assumedRoleSessionId: principal.roleSessionId,
        });
        if (!result.hasPermission) throw userProfileAuthorizationDenied();
        return;
      }
      try {
        const policies = fingerprintIamPolicies(await this.iam.loadPolicies(identity.principal));
        if (initialPolicies !== undefined && initialPolicies !== policies) throw userProfileAuthorizationDenied();
        initialPolicies ??= policies;
        const resource = await iamAuthenticatedUserResourceResolver({ request, principal: identity.principal });
        if (!resource) throw userProfileAuthorizationDenied();
        const start = performance.now(),
          result = await this.iam.authorize({
            principal: identity.principal,
            action,
            resource,
            context: requestConditionContext(request, identity.principal),
          });
        if (!result) throw userProfileAuthorizationDenied();
        (request.iamDecisions ??= []).push({ ...result, action, resource });
        auditIamDecision({
          requestId: request.res?.locals.requestId,
          principal: identity.principal,
          action,
          resource,
          result,
          evaluationLatencyMs: performance.now() - start,
          authorizationMode: mode,
          ...(mode === "shadow" ? { legacyAllowed: true } : {}),
        });
        if (result.decision !== "Allow") throw userProfileAuthorizationDenied();
      } catch (error) {
        if (mode !== "shadow") throw error;
        getLogger("UserEmailIam", LogCategory.SECURITY).warn("Email IAM shadow evaluation failed", {
          action,
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    };
    await recheck();
    return { identity, snapshot, recheck };
  }
  async send(userId: string, newEmail: string, request?: TypedRequest): Promise<void> {
    const parsed = sendEmailChangeCodeBodySchema.safeParse({ newEmail });
    if (!parsed.success)
      throw new BadRequestError("Invalid email change input", undefined, { messageKey: "errors.badRequest" });
    newEmail = parsed.data.newEmail;
    const guard = await this.prepare(userId, request, "quyan:user:SendEmailChangeCode");
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError("用户不存在", undefined, { messageKey: "user.notFound" });

    // 不允许设为当前邮箱
    if (user.email && user.email.toLowerCase() === newEmail.toLowerCase())
      throw new BadRequestError("新邮箱不能与当前邮箱相同", undefined, { messageKey: "user.emailUnchanged" });

    // 检查邮箱唯一性
    const emailExists = await this.userRepository.findByEmailInNonDeleted(newEmail);
    if (emailExists) throw new BadRequestError("该邮箱已被其他用户使用", undefined, { messageKey: "user.emailTaken" });

    // 检查一天内是否已经更换过邮箱（通过业务日志检查）
    const oneDayAgo = new Date(Date.now() - USER_EMAIL_CHANGE_WINDOW_MS);
    const recentEmailChange = await this.businessLogRepository.findRecentSuccessfulOperation(
      userId,
      OperationType.USER_EMAIL_CHANGE,
      oneDayAgo,
    );
    if (recentEmailChange)
      throw new BadRequestError("每天只能修改一次邮箱，请明天再试", undefined, {
        messageKey: "user.emailChangeTooFrequent",
      });

    // 发送验证码到新邮箱
    const emailService = EmailService.getInstance();
    await this.repository.recheckEmail(guard.identity, guard.snapshot, guard.recheck);
    await emailService.sendVerificationCode(newEmail);
  }

  /**
   * 通过验证码更换邮箱
   */
  async change(userId: string, data: ChangeEmailDto, request?: TypedRequest): Promise<void> {
    const parsed = changeEmailBodySchema.safeParse(data);
    if (!parsed.success || Object.keys(data).some((key) => !Object.prototype.hasOwnProperty.call(parsed.data, key)))
      throw new BadRequestError("Invalid email change input", undefined, { messageKey: "errors.badRequest" });
    data = parsed.data;
    const guard = await this.prepare(userId, request, "quyan:user:ChangeEmail");
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError("用户不存在", undefined, { messageKey: "user.notFound" });

    // 不允许设为当前邮箱
    if (user.email && user.email.toLowerCase() === data.newEmail.toLowerCase())
      throw new BadRequestError("新邮箱不能与当前邮箱相同", undefined, { messageKey: "user.emailUnchanged" });

    // 检查邮箱唯一性
    const emailExists = await this.userRepository.findByEmailInNonDeleted(data.newEmail);
    if (emailExists) throw new BadRequestError("该邮箱已被其他用户使用", undefined, { messageKey: "user.emailTaken" });

    // 检查一天内是否已经更换过邮箱
    const oneDayAgo = new Date(Date.now() - USER_EMAIL_CHANGE_WINDOW_MS);
    const recentEmailChange = await this.businessLogRepository.findRecentSuccessfulOperation(
      userId,
      OperationType.USER_EMAIL_CHANGE,
      oneDayAgo,
    );
    if (recentEmailChange)
      throw new BadRequestError("每天只能修改一次邮箱，请明天再试", undefined, {
        messageKey: "user.emailChangeTooFrequent",
      });

    // 验证验证码
    const emailService = EmailService.getInstance();
    const isValid = await emailService.verifyCode(data.newEmail, data.verificationCode);
    if (!isValid)
      throw new BadRequestError("验证码无效或已过期", undefined, { messageKey: "errors.verificationCodeInvalid" });

    const oldEmail = user.email;

    // 更新邮箱
    await this.repository.updateEmail(guard.identity, guard.snapshot, data.newEmail, guard.recheck);

    await this.businessLogService.logOperation({
      operationType: OperationType.USER_EMAIL_CHANGE,
      operationCategory: OperationCategory.USER_MANAGEMENT,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceType: "USER",
      description: `用户 '${user.username}' 将邮箱从 '${oldEmail || "无"}' 更改为 '${data.newEmail}'`,
      changes: { oldEmail, newEmail: data.newEmail },
      success: true,
      ipAddress: request ? extractClientIp(request) : "unknown",
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });
  }
}

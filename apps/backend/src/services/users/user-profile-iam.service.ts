import { env } from "@/config/env";
import { Permission, CustomCode, getOAuthScopeAliases } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";
import { requestConditionContext } from "@/iam/request/condition-context";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import {
  UserProfileManagementRepository,
  userProfileAuthorizationDenied,
  type UserProfileIdentity,
} from "@/store/users/user-profile-management.repository";
import { PermissionService } from "./permission.service";
import { updateProfileBodySchema } from "@/api/schema/users/user.schema";
import { getLogger, LogCategory } from "@/util/logger";
import { BadRequestError, ForbiddenError } from "@/util/errors";

/** Personal profile operations cannot be used to access peers, even under wildcard grants. */
export class UserProfileIamService {
  private static instance: UserProfileIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository = UserProfileManagementRepository.getInstance(),
    private readonly permissions = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new UserProfileIamService());
  }
  private identity(userId: string, request?: TypedRequest): { identity: UserProfileIdentity; request: TypedRequest } {
    const principal = request && getIamPrincipal(request),
      oauth = request?.oauthAccessToken;
    if (
      !request ||
      !principal ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(userId) ||
      principal.subjectUserId !== userId ||
      principal.principalUserId !== userId ||
      (oauth &&
        (oauth.userId !== userId || !getOAuthScopeAliases("profile").some((scope) => oauth.scopes.includes(scope))))
    )
      throw userProfileAuthorizationDenied();
    return {
      identity: { principal, ...(oauth ? { oauth: { id: oauth.id, clientId: oauth.oauthClientId } } : {}) },
      request,
    };
  }
  private async authorize(
    action: "quyan:user:GetCurrentUser" | "quyan:user:UpdateProfile",
    identity: UserProfileIdentity,
    request: TypedRequest,
  ) {
    const mode = env.security.iamAuthorizationMode;
    if (mode !== "enforce" && action === "quyan:user:UpdateProfile") {
      const result = await this.permissions.checkUserPermissions(
        identity.principal.subjectUserId,
        [Permission.USER_UPDATE_SELF_PROFILE],
        { assumedRoleSessionId: identity.principal.roleSessionId },
      );
      if (!result.hasPermission) throw userProfileAuthorizationDenied();
    }
    if (mode === "legacy") return;
    try {
      await this.iam.loadPolicies(identity.principal);
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
      getLogger("UserProfileIamBridge", LogCategory.SECURITY).warn("User profile IAM shadow evaluation denied", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
  }
  async get(userId: string, request?: TypedRequest) {
    const actor = this.identity(userId, request),
      target = await this.repository.target(actor.identity);
    await this.authorize("quyan:user:GetCurrentUser", actor.identity, actor.request);
    return this.repository.hydrate(actor.identity, target);
  }
  async update(userId: string, data: unknown, request?: TypedRequest) {
    if (request?.user?.impersonatorId && request.user.impersonationMode === "view")
      throw new ForbiddenError(
        "Read-only impersonation cannot update a profile",
        CustomCode.IMPERSONATION_READONLY_VIOLATION,
        { messageKey: "errors.impersonationReadonlyViolation" },
      );
    const parsed = updateProfileBodySchema.safeParse(data);
    if (!parsed.success)
      throw new BadRequestError("Invalid profile update", undefined, { messageKey: "errors.badRequest" });
    const actor = this.identity(userId, request),
      target = await this.repository.target(actor.identity);
    await this.authorize("quyan:user:UpdateProfile", actor.identity, actor.request);
    return this.repository.update(actor.identity, target, parsed.data);
  }
}

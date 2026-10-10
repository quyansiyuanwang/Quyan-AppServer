import type { TypedRequest } from "@/types/express";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { accessKeyArn, isCanonicalAccessKeyId } from "@/iam/resources/accesskey-resources";
import {
  AccessKeyManagementRepository,
  accessKeyAuthorizationDenied,
} from "@/store/users/accesskey-management.repository";
/** Fixed server Action evaluated against actual service arguments, never request path/header guesses. */
export class AccessKeyIamService {
  private static instance: AccessKeyIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository = AccessKeyManagementRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new AccessKeyIamService());
  }
  async authorizeRevocation(userId: string, keyId: string, request?: TypedRequest, shadow = false) {
    const principal = request && getIamPrincipal(request);
    if (
      !request ||
      !principal ||
      !isCanonicalAccessKeyId(userId) ||
      !isCanonicalAccessKeyId(keyId) ||
      principal.subjectUserId !== userId ||
      principal.principalUserId !== userId ||
      request.oauthAccessToken
    )
      throw accessKeyAuthorizationDenied();
    await this.iam.loadPolicies(principal);
    const target = await this.repository.target(principal, keyId);
    if (target.id !== keyId || target.userId !== userId) throw accessKeyAuthorizationDenied();
    const action = "quyan:ram:DeleteAccessKey",
      resource = accessKeyArn(principal.accountOwnerId, userId, target.id);
    const start = performance.now();
    const result = await this.iam.authorize({
      principal,
      action,
      resource,
      context: requestConditionContext(request, principal),
    });
    if (!result) throw accessKeyAuthorizationDenied();
    (request.iamDecisions ??= []).push({ ...result, action, resource });
    auditIamDecision({
      requestId: request.res?.locals.requestId,
      principal,
      action,
      resource,
      result,
      evaluationLatencyMs: performance.now() - start,
      authorizationMode: shadow ? "shadow" : "enforce",
      ...(shadow ? { legacyAllowed: true } : {}),
    });
    if (result.decision !== "Allow") throw accessKeyAuthorizationDenied();
    return { principal, target };
  }
  async revoke(userId: string, keyId: string, request?: TypedRequest) {
    const { principal, target } = await this.authorizeRevocation(userId, keyId, request);
    return this.repository.revoke(principal, target);
  }
}

import { performance } from "node:perf_hooks";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { ojApiKeyArn, isCanonicalOjApiKeyId } from "@/iam/resources/oj-apikey-resources";
import { OjApiKeyManagementRepository, ojApiKeyDenied } from "@/store/oj-submitter/oj-apikey-management.repository";
import type { OjApiKeyManagementStore } from "@/store/oj-submitter/oj-apikey-management.store";
import type { TypedRequest } from "@/types/express";
export class OjApiKeyIamService {
  private static instance: OjApiKeyIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: OjApiKeyManagementStore = OjApiKeyManagementRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new OjApiKeyIamService());
  }
  async authorizeDeletion(userId: string, id: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (
      !request ||
      !principal ||
      principal.subjectUserId !== userId ||
      principal.principalUserId !== userId ||
      !isCanonicalOjApiKeyId(userId) ||
      !isCanonicalOjApiKeyId(id)
    )
      throw ojApiKeyDenied();
    await this.iam.loadPolicies(principal);
    const target = await this.repository.target(principal, id);
    if (!target || target.id !== id || target.userId !== userId || target.status !== 1) throw ojApiKeyDenied();
    const action = "quyan:oj:DeleteApiKey",
      resource = ojApiKeyArn(principal.accountOwnerId, userId, target.id);
    for (let check = 0; check < 2; check++) {
      const start = performance.now(),
        result = await this.iam.authorize({
          principal,
          action,
          resource,
          context: requestConditionContext(request, principal),
        });
      if (!result) throw ojApiKeyDenied();
      (request.iamDecisions ??= []).push({ ...result, action, resource });
      auditIamDecision({
        requestId: request.res?.locals.requestId,
        principal,
        action,
        resource,
        result,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
        ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
      });
      if (result.decision !== "Allow") throw ojApiKeyDenied();
    }
    return { principal, target };
  }
  async revoke(userId: string, id: string, request?: TypedRequest) {
    const { principal, target } = await this.authorizeDeletion(userId, id, request);
    return this.repository.revoke(principal, target);
  }
}

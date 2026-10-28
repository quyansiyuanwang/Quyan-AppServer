import { RedisService } from "@/services/infrastructure/redis.service";
import { buildForceOfflineUserKey } from "@/util/auth-session";
import { performance } from "node:perf_hooks";
import { type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { isPlatformUserId, platformUserArn } from "@/iam/resources/platform-user-resources";
import { ImpersonationIamRepository } from "@/store/users/impersonation-iam.repository";
import type { ImpersonationIamStore } from "@/store/users/impersonation-iam.store";
import type { ImpersonationIssuer } from "@/iam/request/impersonation-issuer";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
import type { JWTPayload } from "@/util/auth";
import type { Request } from "express";
const actions = Object.freeze({ act: "quyan:user:StartActImpersonation", view: "quyan:user:StartViewImpersonation" });
export class ImpersonationIamService {
  private static instance: ImpersonationIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: ImpersonationIamStore = ImpersonationIamRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new ImpersonationIamService());
  }
  async start(actorId: string, targetId: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (
      !request ||
      !principal ||
      request.user?.impersonatorId ||
      request.oauthAccessToken ||
      principal.subjectUserId !== actorId ||
      principal.principalUserId !== actorId
    )
      throw iamAccountDenied();
    return this.authorize(principal, targetId, request, request.accessKey?.id);
  }
  private async authorize(
    principal: IamPrincipal,
    targetId: string,
    request: Request,
    accessKeyId?: string,
    requiredMode?: "act" | "view",
    expectedUpdatedAt?: string,
  ) {
    if (
      !isPlatformUserId(targetId) ||
      targetId === principal.subjectUserId ||
      principal.principalUserId !== principal.subjectUserId
    )
      throw iamAccountDenied();
    const snapshot = await this.repository.snapshot(principal, targetId, accessKeyId);
    if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== snapshot.actor.updateTime.toISOString())
      throw iamAccountDenied();
    const hash = fingerprintIamPolicies(await this.iam.loadPolicies(principal)),
      resource = platformUserArn(targetId);
    const allowed = async (mode: "act" | "view") => {
      if (!(mode === "act" ? snapshot.canAct : snapshot.canView)) return false;
      const start = performance.now(),
        action = actions[mode],
        results = await this.iam.authorizeMany({
          principal,
          action,
          resources: [resource],
          context: requestConditionContext(request as TypedRequest, principal),
        });
      if (
        !Array.isArray(results) ||
        results.length !== 1 ||
        !results[0] ||
        !["Allow", "ExplicitDeny", "ImplicitDeny"].includes(results[0].decision)
      )
        throw iamAccountDenied();
      const result = results[0];
      const records = ((request as TypedRequest).iamDecisions ??= []);
      records.push({ ...result, action, resource });
      auditIamDecision({
        principal,
        action,
        resource,
        result,
        requestId: request.res?.locals.requestId,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
      });
      return result.decision === "Allow";
    };
    let selectedMode = requiredMode;
    if (selectedMode) {
      if (!(await allowed(selectedMode))) throw iamAccountDenied();
    } else if (await allowed("act")) selectedMode = "act";
    else if (await allowed("view")) selectedMode = "view";
    else throw iamAccountDenied();
    const grantedMode = selectedMode;
    const current = await this.repository.guarded(
      principal,
      targetId,
      snapshot,
      async () => {
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== hash || !(await allowed(grantedMode)))
          throw iamAccountDenied();
      },
      accessKeyId,
    );
    return {
      mode: grantedMode,
      target: current.target,
      impersonatorUsername: current.actor.username,
      issuer: {
        principal: { ...principal },
        updatedAt: current.actor.updateTime.toISOString(),
        ...(accessKeyId ? { accessKeyId } : {}),
      } satisfies ImpersonationIssuer,
    };
  }
  /** Claims arrive only after JWT signature verification. Re-evaluate the original issuer, including role/key revocation. */
  async validateSession(payload: JWTPayload, request: Request) {
    if (!payload.impersonatorId) return;
    const mode = env.security.iamAuthorizationMode;
    if (mode === "legacy" || mode === "shadow") return;
    if (mode !== "enforce") throw iamAccountDenied();
    const issuer = payload.impersonationIssuer,
      principal = issuer?.principal;
    if (
      !issuer ||
      !principal ||
      !isPlatformUserId(payload.impersonatorId) ||
      principal.subjectUserId !== payload.impersonatorId ||
      principal.principalUserId !== payload.impersonatorId ||
      !isPlatformUserId(principal.accountOwnerId) ||
      !["root", "sub_user", "assumed_role", "access_key", "service"].includes(principal.subjectType) ||
      !["act", "view"].includes(payload.impersonationMode ?? "") ||
      typeof issuer.updatedAt !== "string"
    )
      throw iamAccountDenied();
    if (await RedisService.getInstance().get(buildForceOfflineUserKey(payload.impersonatorId)))
      throw iamAccountDenied();
    await this.authorize(
      { ...principal },
      payload.userId,
      request,
      issuer.accessKeyId,
      payload.impersonationMode,
      issuer.updatedAt,
    );
  }
}

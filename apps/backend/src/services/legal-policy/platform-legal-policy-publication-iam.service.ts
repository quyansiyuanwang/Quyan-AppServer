import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { performance } from "node:perf_hooks";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { platformLegalPolicyArn } from "@/iam/resources/platform-legal-policy-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformLegalPolicyPublicationRepository } from "@/store/content/platform-legal-policy-publication.repository";
import type {
  PlatformLegalPolicyPublicationStore,
  LegalPolicyPublicationOperation,
  LegalPolicyPublicationTransition,
  LegalPolicyPublicationGuard,
} from "@/store/content/platform-legal-policy-publication.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
export class PlatformLegalPolicyPublicationIamService {
  private static instance: PlatformLegalPolicyPublicationIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformLegalPolicyPublicationStore = PlatformLegalPolicyPublicationRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformLegalPolicyPublicationIamService());
  }
  private async evaluate(principal: IamPrincipal, request: TypedRequest, transition: LegalPolicyPublicationTransition) {
    const resources = transition.affected.map((t) => platformLegalPolicyArn(t.id)),
      action = "quyan:legal_policy:" + transition.operation,
      start = performance.now();
    if (
      !resources.length ||
      resources.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(resources).size !== resources.length
    )
      throw iamAccountDenied();
    const results = await this.iam.authorizeMany({
      principal,
      action,
      resources,
      context: requestConditionContext(request, principal),
    });
    if (!resources.length || !Array.isArray(results) || results.length !== resources.length || results.some((r) => !r))
      throw iamAccountDenied();
    results.forEach((result, i) => {
      (request.iamDecisions ??= []).push({ ...result, action, resource: resources[i] });
      auditIamDecision({
        requestId: request.res?.locals.requestId,
        principal,
        action,
        resource: resources[i],
        result,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
        ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
      });
    });
    if (results.some((r) => r.decision !== "Allow")) throw iamAccountDenied();
  }
  async change(
    operation: LegalPolicyPublicationOperation,
    id: string,
    actorUserId: string,
    request: TypedRequest,
    persist = true,
  ) {
    const identity = request && getIamPrincipal(request);
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      identity.subjectUserId !== actorUserId ||
      !["PublishVersion", "UnpublishVersion"].includes(operation)
    )
      throw iamAccountDenied();
    const principal = { ...identity },
      snapshot = await this.identities.snapshot(principal, Permission.LEGAL_POLICY_PUBLISH),
      transition = await this.repository.prepare(principal, id, operation);
    await this.evaluate(principal, request, transition);
    const recheck = async () => {
      await this.identities.recheck(principal, Permission.LEGAL_POLICY_PUBLISH, snapshot);
      await this.evaluate(principal, request, transition);
      await this.identities.recheck(principal, Permission.LEGAL_POLICY_PUBLISH, snapshot);
    };
    const guard: LegalPolicyPublicationGuard = {
      transition,
      group: snapshot.group,
      users: { principal, targetUserId: actorUserId, users: snapshot.users, recheck },
    };
    if (!persist) {
      await recheck();
      return undefined;
    }
    const row = await this.repository.commit(guard);
    return { row, fallbackId: transition.fallbackId, affectedIds: transition.affected.map((t) => t.id) };
  }
}

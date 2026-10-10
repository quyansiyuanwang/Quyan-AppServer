import { MANAGED_STATUS, type IamPrincipal } from "@quyan/shared";
import type { AccessKeyDto, AccessKeyPageDto } from "@/api/dto/users/accesskey.dto";
import type { IamManagementPage } from "@/iam/management-pagination";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { AccessKeyTarget } from "@/store/users/accesskey-management.repository";
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
  private async actor(userId: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (
      !request ||
      !principal ||
      !isCanonicalAccessKeyId(userId) ||
      principal.subjectUserId !== userId ||
      principal.principalUserId !== userId ||
      request.oauthAccessToken
    )
      throw accessKeyAuthorizationDenied();
    await this.iam.loadPolicies(principal);
    await this.repository.assertPrincipal(principal);
    return { principal, request };
  }
  private async allowedRows(
    principal: IamPrincipal,
    request: TypedRequest,
    rows: readonly AccessKeyTarget[],
    shadow: boolean,
  ) {
    if (!rows.length) return [];
    if (
      rows.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      rows.some(
        (row) =>
          row.userId !== principal.subjectUserId ||
          row.status !== MANAGED_STATUS.ENABLED ||
          !isCanonicalAccessKeyId(row.id),
      )
    )
      throw accessKeyAuthorizationDenied();
    const action = "quyan:ram:ListAccessKeys",
      start = performance.now();
    const resources = rows.map((row) => accessKeyArn(principal.accountOwnerId, row.userId, row.id));
    const results = await this.iam.authorizeMany({
      principal,
      action,
      resources,
      context: requestConditionContext(request, principal),
    });
    if (!Array.isArray(results) || results.length !== rows.length || Array.from(results).some((result) => !result))
      throw accessKeyAuthorizationDenied();
    results.forEach((result, index) => {
      (request.iamDecisions ??= []).push({ ...result, action, resource: resources[index] });
      auditIamDecision({
        requestId: request.res?.locals.requestId,
        principal,
        action,
        resource: resources[index],
        result,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: shadow ? "shadow" : "enforce",
        ...(shadow ? { legacyAllowed: true } : {}),
        batchSize: resources.length,
        batchIndex: index,
      });
    });
    return rows.filter((_, index) => results[index].decision === "Allow");
  }
  private async hydrate(
    principal: IamPrincipal,
    request: TypedRequest,
    rows: readonly AccessKeyTarget[],
    shadow: boolean,
  ) {
    await this.iam.loadPolicies(principal);
    const allowed = await this.allowedRows(principal, request, rows, shadow);
    if (allowed.length !== rows.length) throw accessKeyAuthorizationDenied();
    return this.repository.hydrate(principal, rows);
  }
  async listPage(
    userId: string,
    page: IamManagementPage,
    request?: TypedRequest,
    shadow = false,
  ): Promise<AccessKeyPageDto> {
    const actor = await this.actor(userId, request);
    const candidates = await this.repository.candidates(actor.principal, page);
    const selected = await this.allowedRows(actor.principal, actor.request, candidates.slice(0, page.pageSize), shadow);
    const items = await this.hydrate(actor.principal, actor.request, selected, shadow);
    return { ...page, items, hasNext: candidates.length > page.pageSize };
  }
  /** Array compatibility endpoint remains complete, never silently truncates to the first page. */
  async list(userId: string, request?: TypedRequest, shadow = false): Promise<AccessKeyDto[]> {
    const actor = await this.actor(userId, request);
    const selected: AccessKeyTarget[] = [];
    let after: AccessKeyTarget | undefined;
    while (true) {
      const rows = await this.repository.scan(actor.principal, after);
      selected.push(...(await this.allowedRows(actor.principal, actor.request, rows, shadow)));
      if (rows.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
      after = rows[rows.length - 1];
    }
    const result: AccessKeyDto[] = [];
    for (let i = 0; i < selected.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest)
      result.push(
        ...(await this.hydrate(
          actor.principal,
          actor.request,
          selected.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
          shadow,
        )),
      );
    await this.repository.assertPrincipal(actor.principal);
    return result;
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

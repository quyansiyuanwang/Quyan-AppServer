import { performance } from "node:perf_hooks";
import { getIamActionDefinition, getIamResourceType, type IamPrincipal, type Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { PermissionService } from "@/services/users/permission.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";

/** Aggregate system information only; entity reads, mutations and collections require their own services. */
export class PlatformManagementReadIamService {
  private static instance: PlatformManagementReadIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformManagementReadIamService());
  }
  private async evaluate(principal: IamPrincipal, action: string, resource: string, request: TypedRequest) {
    const start = performance.now();
    const result = await this.iam.authorize({
      principal,
      action,
      resource,
      context: requestConditionContext(request, principal),
    });
    if (!result) throw iamAccountDenied();
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
    if (result.decision !== "Allow") throw iamAccountDenied();
  }
  private async prepare(
    principal: IamPrincipal,
    permission: Permission,
    action: string,
    resource: string,
    request: TypedRequest,
  ) {
    const snapshot = await this.repository.snapshot(principal, permission);
    await this.evaluate(principal, action, resource, request);
    return async () => {
      await this.repository.recheck(principal, permission, snapshot);
      await this.evaluate(principal, action, resource, request);
      await this.repository.recheck(principal, permission, snapshot);
    };
  }
  async read<T>(action: string, resource: string, request: TypedRequest, read: () => Promise<T>): Promise<T> {
    if (!["legacy", "shadow", "enforce"].includes(env.security.iamAuthorizationMode)) throw iamAccountDenied();
    const identity = request && getIamPrincipal(request),
      definition = getIamActionDefinition(action),
      type = getIamResourceType(resource);
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      definition?.authorizationBoundary !== "platform" ||
      !definition.legacyPermission ||
      definition.accessLevel !== "Read" ||
      type?.accountScope !== "platform" ||
      type.id !== "platform/system" ||
      !definition.resourceTypes.includes(type.id)
    )
      throw iamAccountDenied();
    const principal = { ...identity },
      permission = definition.legacyPermission;
    if (env.security.iamAuthorizationMode === "enforce") {
      const recheck = await this.prepare(principal, permission, action, resource, request);
      const result = await read();
      await recheck();
      return result;
    }
    if (
      !(
        await this.permissions.checkUserPermissions(principal.subjectUserId, [permission], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (env.security.iamAuthorizationMode === "shadow") {
      try {
        const recheck = await this.prepare(principal, permission, action, resource, request);
        await recheck();
      } catch {
        getLogger("PlatformManagementRead", LogCategory.SECURITY).warn("Platform read shadow evaluation failed", {
          action,
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    }
    return read();
  }
}

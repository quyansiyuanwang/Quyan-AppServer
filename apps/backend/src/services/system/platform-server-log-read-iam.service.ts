import { performance } from "node:perf_hooks";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import type { IamPolicyInput } from "@/iam/evaluator/policy-evaluator";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isServerLogResourceName, platformServerLogArn } from "@/iam/resources/platform-server-log-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { NotFoundError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { ServerLogContentDTO, ServerLogFilesDTO } from "@/api/dto/system/system.dto";
type Action = "quyan:system:server_log:ListFiles" | "quyan:system:server_log:GetFileContent";
const permission = Permission.SYSTEM_SERVER_LOG_READ;
export class PlatformServerLogReadIamService {
  private static instance: PlatformServerLogReadIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "evaluateLoadedPolicies"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformServerLogReadIamService());
  }
  private principal(request: TypedRequest) {
    const identity = getIamPrincipal(request);
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !["legacy", "shadow", "enforce"].includes(env.security.iamAuthorizationMode)
    )
      throw iamAccountDenied();
    return { ...identity };
  }
  private async legacy(principal: IamPrincipal) {
    if (
      !(
        await this.permissions.checkUserPermissions(principal.subjectUserId, [permission], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
  }
  private async prepare(principal: IamPrincipal) {
    const policies = await this.iam.loadPolicies(principal),
      hash = fingerprintIamPolicies(policies);
    const snapshot = await this.snapshots.snapshot(principal, permission);
    const recheck = async () => {
      await this.snapshots.recheck(principal, permission, snapshot);
      if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== hash) throw iamAccountDenied();
    };
    await recheck();
    return { policies, recheck };
  }
  private async evaluate(
    action: Action,
    names: string[],
    principal: IamPrincipal,
    policies: readonly IamPolicyInput[],
    request: TypedRequest,
  ): Promise<boolean[]> {
    const allowed: boolean[] = [];
    for (let offset = 0; offset < names.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const resources = names
          .slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest)
          .map(platformServerLogArn),
        start = performance.now();
      const results = await this.iam.evaluateLoadedPolicies({
        principal,
        policies,
        action,
        resources,
        context: requestConditionContext(request, principal),
      });
      if (results.length !== resources.length || resources.some((_, index) => !results[index]))
        throw iamAccountDenied();
      results.forEach((result, index) => {
        const resource = resources[index]!;
        if ((request.iamDecisions ??= []).length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest)
          request.iamDecisions.push({ ...result, action, resource });
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
        allowed.push(result.decision === "Allow");
      });
    }
    return allowed;
  }
  private shadowFailure(action: Action) {
    getLogger("ServerLogReadIam", LogCategory.SECURITY).warn("Server log IAM shadow evaluation failed", {
      action,
      reason: "iam-evaluation-denied-or-unavailable",
    });
  }
  async list(request: TypedRequest, hydrate: () => Promise<ServerLogFilesDTO>): Promise<ServerLogFilesDTO> {
    const principal = this.principal(request),
      action = "quyan:system:server_log:ListFiles";
    if (env.security.iamAuthorizationMode !== "enforce") {
      await this.legacy(principal);
      const result = await hydrate();
      if (env.security.iamAuthorizationMode === "shadow") {
        try {
          await this.filter(result, principal, request);
        } catch {
          this.shadowFailure(action);
        }
      }
      return result;
    }
    // Eligibility precedes even metadata enumeration; only authorized metadata leaves this service.
    const guard = await this.prepare(principal);
    return this.filter(await hydrate(), principal, request, guard);
  }
  private async filter(
    result: ServerLogFilesDTO,
    principal: IamPrincipal,
    request: TypedRequest,
    guard?: Awaited<ReturnType<PlatformServerLogReadIamService["prepare"]>>,
  ) {
    guard ??= await this.prepare(principal);
    if (
      !result ||
      !Array.isArray(result.files) ||
      result.files.some((file) => !isServerLogResourceName(file.name)) ||
      new Set(result.files.map((file) => file.name)).size !== result.files.length
    )
      throw iamAccountDenied();
    const names = result.files.map((file) => file.name);
    await guard.recheck();
    const allowed = await this.evaluate("quyan:system:server_log:ListFiles", names, principal, guard.policies, request);
    await guard.recheck();
    const final = await this.evaluate("quyan:system:server_log:ListFiles", names, principal, guard.policies, request);
    if (allowed.some((value, index) => value !== final[index])) throw iamAccountDenied();
    await guard.recheck();
    return { files: result.files.filter((_, index) => allowed[index]) };
  }
  async content(
    fileName: string,
    request: TypedRequest,
    hydrate: () => Promise<ServerLogContentDTO | null>,
  ): Promise<ServerLogContentDTO> {
    const principal = this.principal(request),
      action = "quyan:system:server_log:GetFileContent";
    if (!isServerLogResourceName(fileName)) throw iamAccountDenied();
    const authorize = async (guard: Awaited<ReturnType<PlatformServerLogReadIamService["prepare"]>>) => {
      await guard.recheck();
      if (!(await this.evaluate(action, [fileName], principal, guard.policies, request))[0]) throw iamAccountDenied();
      await guard.recheck();
    };
    if (env.security.iamAuthorizationMode !== "enforce") {
      await this.legacy(principal);
      if (env.security.iamAuthorizationMode === "shadow") {
        try {
          await authorize(await this.prepare(principal));
        } catch {
          this.shadowFailure(action);
        }
      }
      const result = await hydrate();
      if (!result) throw new NotFoundError("Log file not found", undefined, { messageKey: "system.logFileNotFound" });
      return result;
    }
    const guard = await this.prepare(principal);
    await authorize(guard);
    const result = await hydrate();
    if (result && result.file?.name !== fileName) throw iamAccountDenied();
    await authorize(guard);
    if (!result) throw new NotFoundError("Log file not found", undefined, { messageKey: "system.logFileNotFound" });
    return result;
  }
}

import { performance } from "node:perf_hooks";
import { Permission, getIamActionDefinition } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { isAiRequestLogResourceId, platformAiRequestLogArn } from "@/iam/resources/platform-ai-request-log-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformAiRequestLogReadRepository } from "@/store/system/platform-ai-request-log-read.repository";
import type { PlatformAiRequestLogReadStore } from "@/store/system/platform-ai-request-log-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
export type PlatformAiLogReadAction =
  | "quyan:relay:ai_request_log:GetMetadata"
  | "quyan:relay:ai_request_log:GetContent"
  | "quyan:relay:ai_request_log:SearchContent"
  | "quyan:relay:ai_request_log:GetAttempts"
  | "quyan:relay:ai_request_log:GetLog";
const diagnosticsAction = "quyan:relay:ai_request_log:ReadDiagnostics";
export class PlatformAiRequestLogReadIamService {
  private static instance: PlatformAiRequestLogReadIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformAiRequestLogReadStore = PlatformAiRequestLogReadRepository.getInstance(),
    private readonly permissions = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformAiRequestLogReadIamService());
  }
  async read<T>(
    action: PlatformAiLogReadAction,
    id: string,
    request: TypedRequest,
    hydrate: () => Promise<T>,
    diagnostics = false,
  ): Promise<T> {
    const identity = getIamPrincipal(request),
      definition = getIamActionDefinition(action);
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !isAiRequestLogResourceId(id) ||
      !definition ||
      definition.legacyPermission !== Permission.RELAY_AI_REQUEST_LOG_READ ||
      definition.accessLevel !== "Read" ||
      definition.authorizationBoundary !== "platform" ||
      !definition.resourceTypes.includes("platform/relay-ai-request-log") ||
      (diagnostics &&
        !["quyan:relay:ai_request_log:SearchContent", "quyan:relay:ai_request_log:GetAttempts"].includes(action))
    )
      throw iamAccountDenied();
    const principal = { ...identity },
      resource = platformAiRequestLogArn(id);
    const requiresDiagnostics = diagnostics || action === "quyan:relay:ai_request_log:GetAttempts";
    const required = [
      Permission.RELAY_AI_REQUEST_LOG_READ,
      ...(requiresDiagnostics ? [Permission.RELAY_REQUEST_DIAGNOSTICS_READ] : []),
    ];
    const prepare = async () => {
      await this.iam.loadPolicies(principal);
      const snapshots = await Promise.all(
        required.map(async (permission) => ({
          permission,
          snapshot: await this.snapshots.snapshot(principal, permission),
        })),
      );
      const authorize = async () => {
        for (const row of snapshots) await this.snapshots.recheck(principal, row.permission, row.snapshot);
        for (const current of [action, ...(requiresDiagnostics ? [diagnosticsAction] : [])]) {
          const start = performance.now(),
            result = await this.iam.authorize({
              principal,
              action: current,
              resource,
              context: requestConditionContext(request, principal),
            });
          if (!result) throw iamAccountDenied();
          (request.iamDecisions ??= []).push({ ...result, action: current, resource });
          auditIamDecision({
            requestId: request.res?.locals.requestId,
            principal,
            action: current,
            resource,
            result,
            evaluationLatencyMs: performance.now() - start,
            authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
            ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
          });
          if (result.decision !== "Allow") throw iamAccountDenied();
        }
      };
      await authorize();
      const target = await this.repository.target(id);
      if (
        !target ||
        target.id !== id ||
        target.status !== 1 ||
        !(target.updateTime instanceof Date) ||
        !Number.isFinite(target.updateTime.getTime())
      )
        throw iamAccountDenied();
      const recheck = async () => {
        await authorize();
        const current = await this.repository.target(id);
        if (
          !current ||
          current.id !== target.id ||
          current.status !== 1 ||
          current.updateTime.getTime() !== target.updateTime.getTime()
        )
          throw iamAccountDenied();
      };
      await recheck();
      return recheck;
    };
    if (env.security.iamAuthorizationMode !== "enforce") {
      if (
        !["legacy", "shadow"].includes(env.security.iamAuthorizationMode) ||
        !(
          await this.permissions.checkUserPermissions(principal.subjectUserId, required, {
            assumedRoleSessionId: principal.roleSessionId,
          })
        ).hasPermission
      )
        throw iamAccountDenied();
      if (env.security.iamAuthorizationMode === "shadow") {
        try {
          await prepare();
        } catch {
          getLogger("AiRequestLogIam", LogCategory.SECURITY).warn("AI request log IAM shadow evaluation failed", {
            reason: "iam-evaluation-denied-or-unavailable",
          });
        }
      }
      return hydrate();
    }
    const recheck = await prepare();
    const result = await hydrate();
    await recheck();
    return result;
  }
}

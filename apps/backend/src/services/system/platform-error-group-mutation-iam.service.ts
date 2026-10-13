import { performance } from "node:perf_hooks";
import { Permission, getIamActionDefinition } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { requestConditionContext } from "@/iam/request/condition-context";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { isErrorGroupResourceId, platformErrorGroupArn } from "@/iam/resources/platform-error-group-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformErrorGroupMutationRepository } from "@/store/system/platform-error-group-mutation.repository";
import type {
  ErrorGroupMutationGuard,
  PlatformErrorGroupMutationStore,
} from "@/store/system/platform-error-group-mutation.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { updateErrorGroupStatusBodySchema } from "@/api/schema/system/error-report.schema";
import { BadRequestError, NotFoundError } from "@/util/errors";
import { PermissionService } from "@/services/users/permission.service";
import { ErrorReportService } from "./error-report.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { UpdateErrorGroupStatusRequest } from "@/api/dto/system/error-report.dto";
const action = "quyan:system:error_report:UpdateErrorGroupStatus";
export class PlatformErrorGroupMutationIamService {
  private static instance: PlatformErrorGroupMutationIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformErrorGroupMutationStore = PlatformErrorGroupMutationRepository.getInstance(),
    private readonly permissions = PermissionService.getInstance(),
    private readonly reports = ErrorReportService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformErrorGroupMutationIamService());
  }
  async prepare(id: string, request: TypedRequest): Promise<ErrorGroupMutationGuard> {
    const identity = getIamPrincipal(request);
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !isErrorGroupResourceId(id)
    )
      throw iamAccountDenied();
    const principal = { ...identity },
      resource = platformErrorGroupArn(id);
    await this.iam.loadPolicies(principal);
    const update = await this.snapshots.snapshot(principal, Permission.SYSTEM_ERROR_REPORT_UPDATE);
    const read = await this.snapshots.snapshot(principal, Permission.SYSTEM_ERROR_REPORT_READ);
    if (update.group.id !== read.group.id || update.group.updateTime.getTime() !== read.group.updateTime.getTime())
      throw iamAccountDenied();
    const revision = await this.repository.authorizationRevision(principal);
    const recheck = async () => {
      await this.snapshots.recheck(principal, Permission.SYSTEM_ERROR_REPORT_UPDATE, update);
      await this.snapshots.recheck(principal, Permission.SYSTEM_ERROR_REPORT_READ, read);
      const definition = getIamActionDefinition(action);
      if (!definition?.requiredActions?.length) throw iamAccountDenied();
      for (const required of [action, ...definition.requiredActions]) {
        const start = performance.now(),
          result = await this.iam.authorize({
            principal,
            action: required,
            resource,
            context: requestConditionContext(request, principal),
          });
        if (!result) throw iamAccountDenied();
        (request.iamDecisions ??= []).push({ ...result, action: required, resource });
        auditIamDecision({
          requestId: request.res?.locals.requestId,
          principal,
          action: required,
          resource,
          result,
          evaluationLatencyMs: performance.now() - start,
          authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
          ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
        });
        if (result.decision !== "Allow") throw iamAccountDenied();
      }
    };
    await recheck();
    const target = await this.repository.target(id);
    if (
      !target ||
      target.id !== id ||
      target.status !== 1 ||
      !(target.updateTime instanceof Date) ||
      !Number.isFinite(target.updateTime.getTime())
    )
      throw iamAccountDenied();
    await recheck();
    return {
      action,
      target,
      authorizationRevision: revision,
      group: update.group,
      users: { principal, targetUserId: principal.subjectUserId, users: update.users, recheck },
    };
  }
  async update(id: string, input: UpdateErrorGroupStatusRequest, request: TypedRequest) {
    const parsed = updateErrorGroupStatusBodySchema.strict().safeParse(input),
      principal = getIamPrincipal(request);
    if (!parsed.success)
      throw new BadRequestError("Invalid error status", undefined, { messageKey: "errors.badRequest" });
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== principal.principalUserId ||
      !isErrorGroupResourceId(id)
    )
      throw iamAccountDenied();
    if (env.security.iamAuthorizationMode !== "enforce") {
      if (
        !["legacy", "shadow"].includes(env.security.iamAuthorizationMode) ||
        !(
          await this.permissions.checkUserPermissions(
            principal.subjectUserId,
            [Permission.SYSTEM_ERROR_REPORT_UPDATE],
            { assumedRoleSessionId: principal.roleSessionId },
          )
        ).hasPermission
      )
        throw iamAccountDenied();
      if (env.security.iamAuthorizationMode === "shadow") {
        try {
          await this.prepare(id, request);
        } catch {
          getLogger("ErrorGroupMutationIam", LogCategory.SECURITY).warn("Error status IAM shadow evaluation failed", {
            reason: "iam-evaluation-denied-or-unavailable",
          });
        }
      }
      const group = await this.reports.getGroup(id);
      if (!group)
        throw new NotFoundError("Error group not found", undefined, { messageKey: "system.errorGroupNotFound" });
      return this.reports.updateGroupStatus(id, parsed.data.resolutionStatus);
    }
    return this.repository.update(await this.prepare(id, request), parsed.data);
  }
}

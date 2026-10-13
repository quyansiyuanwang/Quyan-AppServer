import { performance } from "node:perf_hooks";
import { iamLegacyPermissionsForAction } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { platformIpAddressIdentifier, platformIpAddressArn } from "@/iam/resources/platform-ip-address-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformIPBlacklistRecordReadRepository } from "@/store/security/platform-ip-blacklist-record-read.repository";
import type { PlatformIPBlacklistRecordReadStore } from "@/store/security/platform-ip-blacklist-record-read.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { getLogger, LogCategory } from "@/util/logger";
import { NotFoundError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
import type { IPBlackList } from "@prisma/client";
const action = "quyan:system:ip_blacklist:GetBlacklist";
export class PlatformIPBlacklistRecordReadIamService {
  private static instance: PlatformIPBlacklistRecordReadIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorize"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformIPBlacklistRecordReadStore = PlatformIPBlacklistRecordReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformIPBlacklistRecordReadIamService());
  }
  async read(id: string, request: TypedRequest): Promise<IPBlackList> {
    const identity = getIamPrincipal(request),
      required = iamLegacyPermissionsForAction(action);
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !isPlatformLogResourceId(id) ||
      !required.length ||
      !["legacy", "shadow", "enforce"].includes(env.security.iamAuthorizationMode)
    )
      throw iamAccountDenied();
    const principal = { ...identity };
    const prepare = async () => {
      const policyHash = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const snapshot = await this.snapshots.snapshot(principal, required);
      const target = await this.repository.target(id);
      if (
        !target ||
        target.id !== id ||
        target.status !== 1 ||
        !platformIpAddressIdentifier(target.ipAddress) ||
        !(target.createTime instanceof Date) ||
        !Number.isFinite(target.createTime.getTime()) ||
        !(target.updateTime instanceof Date) ||
        !Number.isFinite(target.updateTime.getTime())
      )
        throw iamAccountDenied();
      const resource = platformIpAddressArn(target.ipAddress);
      const authorize = async () => {
        await this.snapshots.recheck(principal, required, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policyHash) throw iamAccountDenied();
        const start = performance.now(),
          result = await this.iam.authorize({
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
        await this.snapshots.recheck(principal, required, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policyHash) throw iamAccountDenied();
      };
      await authorize();
      const recheck = async () => {
        await authorize();
        const current = await this.repository.target(id);
        if (
          !current ||
          current.id !== id ||
          current.status !== 1 ||
          current.ipAddress !== target.ipAddress ||
          !(current.createTime instanceof Date) ||
          current.createTime.getTime() !== target.createTime.getTime() ||
          !(current.updateTime instanceof Date) ||
          current.updateTime.getTime() !== target.updateTime.getTime()
        )
          throw iamAccountDenied();
      };
      return { target, recheck };
    };
    if (env.security.iamAuthorizationMode !== "enforce") {
      const result = await this.permissions.checkUserPermissions(principal.subjectUserId, required, {
        assumedRoleSessionId: principal.roleSessionId,
      });
      if (
        !result.checkedPermissions.some(
          (permission) => required.includes(permission) && !result.missingPermissions?.includes(permission),
        )
      )
        throw iamAccountDenied();
      if (env.security.iamAuthorizationMode === "shadow") {
        try {
          await prepare();
        } catch {
          getLogger("IPBlacklistRecordReadIam", LogCategory.SECURITY).warn(
            "IP blacklist record IAM shadow evaluation failed",
            {
              action,
              reason: "iam-evaluation-denied-or-unavailable",
            },
          );
        }
      }
      const target = await this.repository.target(id);
      if (!target)
        throw new NotFoundError("Blacklist record not found", undefined, { messageKey: "ipBlacklist.recordNotFound" });
      const record = await this.repository.hydrate(target);
      if (!record)
        throw new NotFoundError("Blacklist record not found", undefined, { messageKey: "ipBlacklist.recordNotFound" });
      return record;
    }
    const guard = await prepare(),
      record = await this.repository.hydrate(guard.target);
    if (
      !record ||
      record.id !== id ||
      record.status !== 1 ||
      record.ipAddress !== guard.target.ipAddress ||
      !(record.createTime instanceof Date) ||
      record.createTime.getTime() !== guard.target.createTime.getTime() ||
      !(record.updateTime instanceof Date) ||
      record.updateTime.getTime() !== guard.target.updateTime.getTime()
    )
      throw iamAccountDenied();
    await guard.recheck();
    return record;
  }
}

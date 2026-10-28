import { performance } from "node:perf_hooks";
import { iamLegacyPermissionsForAction } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { platformIpAddressIdentifier, platformIpAddressArn } from "@/iam/resources/platform-ip-address-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformIpAddressReadRepository } from "@/store/security/platform-ip-address-read.repository";
import type {
  PlatformIpAddressSnapshot,
  PlatformIpAddressReadStore,
} from "@/store/security/platform-ip-address-read.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { getLogger, LogCategory } from "@/util/logger";
import { IPBlackListService } from "./ipblacklist.service";
import type { IPErrorStatusResponse } from "@/api/dto/system/ipblacklist.dto";
import type { IPBlackList } from "@/store/security/ipblacklist.store";
import type { TypedRequest } from "@/types/express";

export class PlatformIpAddressReadIamService {
  private static instance: PlatformIpAddressReadIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorize"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformIpAddressReadStore = PlatformIpAddressReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
    private readonly reports: Pick<
      IPBlackListService,
      "isIpBlacklisted" | "getBlacklistInfo" | "getIpErrorStatus"
    > = IPBlackListService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformIpAddressReadIamService());
  }
  async check(
    ip: string,
    request: TypedRequest,
  ): Promise<{ isBlacklisted: boolean; blacklistInfo: IPBlackList | null }> {
    return this.read("quyan:system:ip_blacklist:CheckIPAddress", ip, request, async (target) => {
      const isBlacklisted = await this.reports.isIpBlacklisted(ip);
      const blacklistInfo = isBlacklisted ? await this.reports.getBlacklistInfo(ip) : null;
      if (
        target !== undefined &&
        (typeof isBlacklisted !== "boolean" ||
          (isBlacklisted &&
            (!target ||
              !blacklistInfo ||
              blacklistInfo.id !== target.id ||
              blacklistInfo.ipAddress !== ip ||
              blacklistInfo.status !== 1 ||
              !(blacklistInfo.updateTime instanceof Date) ||
              blacklistInfo.updateTime.getTime() !== target.updateTime.getTime())))
      )
        throw iamAccountDenied();
      return { isBlacklisted, blacklistInfo };
    });
  }
  async errorStatus(ip: string, request: TypedRequest): Promise<IPErrorStatusResponse> {
    return this.read("quyan:system:ip_blacklist:GetIPAddressErrorStatus", ip, request, async () => {
      const result = await this.reports.getIpErrorStatus(ip);
      if (!result || result.ipAddress !== ip) throw iamAccountDenied();
      return result;
    });
  }
  private async read<Result>(
    action: "quyan:system:ip_blacklist:CheckIPAddress" | "quyan:system:ip_blacklist:GetIPAddressErrorStatus",
    ip: string,
    request: TypedRequest,
    hydrate: (target?: PlatformIpAddressSnapshot) => Promise<Result>,
  ): Promise<Result> {
    const identity = getIamPrincipal(request),
      required = iamLegacyPermissionsForAction(action);
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !platformIpAddressIdentifier(ip) ||
      !required.length ||
      !["legacy", "shadow", "enforce"].includes(env.security.iamAuthorizationMode)
    )
      throw iamAccountDenied();
    const principal = { ...identity },
      resource = platformIpAddressArn(ip);
    const prepare = async () => {
      const policyHash = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const snapshot = await this.snapshots.snapshot(principal, required);
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
      const target = await this.repository.target(ip);
      const valid = (row: Awaited<ReturnType<PlatformIpAddressReadStore["target"]>>) =>
        row === null ||
        (!!row &&
          row.ipAddress === ip &&
          row.status === 1 &&
          typeof row.id === "string" &&
          /^[A-Za-z0-9_-]{1,191}$/.test(row.id) &&
          row.updateTime instanceof Date &&
          Number.isFinite(row.updateTime.getTime()));
      if (!valid(target)) throw iamAccountDenied();
      const recheck = async () => {
        await authorize();
        const current = await this.repository.target(ip);
        if (
          !valid(current) ||
          Boolean(current) !== Boolean(target) ||
          (target &&
            (!current || current.id !== target.id || current.updateTime.getTime() !== target.updateTime.getTime()))
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
          getLogger("IpAddressReadIam", LogCategory.SECURITY).warn("IP address IAM shadow evaluation failed", {
            action,
            reason: "iam-evaluation-denied-or-unavailable",
          });
        }
      }
      const log = await hydrate();
      return log;
    }
    const prepared = await prepare();
    const result = await hydrate(prepared.target);
    await prepared.recheck();
    return result;
  }
}

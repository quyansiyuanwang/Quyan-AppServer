import { performance } from "node:perf_hooks";
import { Permission, iamLegacyPermissionsForAction, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { platformIpAddressIdentifier, platformIpAddressArn } from "@/iam/resources/platform-ip-address-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformIpBlacklistMutationRepository } from "@/store/security/platform-ip-blacklist-mutation.repository";
import type {
  IpBlacklistMutationAction,
  PlatformIpBlacklistMutationStore,
} from "@/store/security/platform-ip-blacklist-mutation.store";
import { IPBlackListRepository } from "@/store/security/ipblacklist";
import type { IPBlackListStore } from "@/store/security/ipblacklist.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { createIPBlacklistBodySchema, updateIPBlacklistBodySchema } from "@/api/schema/system/ipblacklist.schema";
import type { CreateIPBlacklistDto, UpdateIPBlacklistDto } from "@/api/dto/system/ipblacklist.dto";
import { BadRequestError, NotFoundError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import { IPBlackListService } from "./ipblacklist.service";
const action = "quyan:system:ip_blacklist:UpdateBlacklist";
export class PlatformIpBlacklistMutationIamService {
  private static instance: PlatformIpBlacklistMutationIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorize"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformIpBlacklistMutationStore = PlatformIpBlacklistMutationRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
    private readonly legacy: Pick<
      IPBlackListStore,
      "findByIpAnyStatus" | "update"
    > = IPBlackListRepository.getInstance(),
    private readonly reports: Pick<
      IPBlackListService,
      "manualBan" | "unban" | "logManualBan" | "logManualUnban"
    > = IPBlackListService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformIpBlacklistMutationIamService());
  }
  private async prepare(action: IpBlacklistMutationAction, ip: string, principal: IamPrincipal, request: TypedRequest) {
    const required = iamLegacyPermissionsForAction(action);
    if (required.length !== 1) throw iamAccountDenied();
    const hash = fingerprintIamPolicies(await this.iam.loadPolicies(principal)),
      snapshot = await this.snapshots.snapshot(principal, required),
      revision = await this.repository.authorizationRevision(principal);
    const target = await this.repository.target(ip);
    if (
      target &&
      (target.ipAddress !== ip ||
        !isPlatformLogResourceId(target.id) ||
        !(target.updateTime instanceof Date) ||
        !Number.isFinite(target.updateTime.getTime()))
    )
      throw iamAccountDenied();
    if (action !== "quyan:system:ip_blacklist:CreateBlacklist" && (!target || target.status !== 1))
      throw iamAccountDenied();
    const resource = platformIpAddressArn(ip);
    const recheck = async () => {
      await this.snapshots.recheck(principal, required, snapshot);
      if (
        (await this.repository.authorizationRevision(principal)) !== revision ||
        fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== hash
      )
        throw iamAccountDenied();
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
      if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== hash) throw iamAccountDenied();
    };
    await recheck();
    return {
      target,
      guard: {
        action,
        authorizationRevision: revision,
        group: snapshot.group,
        users: { principal, targetUserId: principal.subjectUserId, users: snapshot.users, recheck },
      },
    };
  }
  async update(ip: string, body: UpdateIPBlacklistDto, request: TypedRequest) {
    const parsed = updateIPBlacklistBodySchema.strict().safeParse(body);
    if (!parsed.success)
      throw new BadRequestError("Invalid blacklist update", undefined, { messageKey: "errors.badRequest" });
    const identity = getIamPrincipal(request);
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !platformIpAddressIdentifier(ip) ||
      !["legacy", "shadow", "enforce"].includes(env.security.iamAuthorizationMode)
    )
      throw iamAccountDenied();
    const principal = { ...identity },
      input = {
        ...(parsed.data.banReason !== undefined ? { reason: parsed.data.banReason } : {}),
        ...(parsed.data.expireTime !== undefined ? { expireTime: new Date(parsed.data.expireTime) } : {}),
      };
    if (env.security.iamAuthorizationMode !== "enforce") {
      if (
        !(
          await this.permissions.checkUserPermissions(principal.subjectUserId, [Permission.IP_BLACKLIST_UPDATE], {
            assumedRoleSessionId: principal.roleSessionId,
          })
        ).hasPermission
      )
        throw iamAccountDenied();
      if (env.security.iamAuthorizationMode === "shadow")
        try {
          await this.prepare(action, ip, principal, request);
        } catch {
          getLogger("BlacklistMutationIam", LogCategory.SECURITY).warn(
            "Blacklist update IAM shadow evaluation failed",
            { action, reason: "iam-evaluation-denied-or-unavailable" },
          );
        }
      const record = await this.legacy.findByIpAnyStatus(ip);
      if (!record)
        throw new NotFoundError("IP blacklist record not found", undefined, {
          messageKey: "ipBlacklist.recordNotFound",
        });
      return this.legacy.update(record.id, {
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.expireTime !== undefined ? { ExpireTime: input.expireTime } : {}),
      });
    }
    const prepared = await this.prepare(action, ip, principal, request);
    if (!prepared.target) throw iamAccountDenied();
    return this.repository.update(prepared.target, input, prepared.guard);
  }
  private identity(ip: string, request: TypedRequest) {
    const principal = getIamPrincipal(request);
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== principal.principalUserId ||
      !platformIpAddressIdentifier(ip) ||
      !["legacy", "shadow", "enforce"].includes(env.security.iamAuthorizationMode)
    )
      throw iamAccountDenied();
    return { ...principal };
  }
  private async legacyPermission(principal: IamPrincipal, permission: Permission) {
    if (
      !(
        await this.permissions.checkUserPermissions(principal.subjectUserId, [permission], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
  }
  private async shadow(action: IpBlacklistMutationAction, ip: string, principal: IamPrincipal, request: TypedRequest) {
    if (env.security.iamAuthorizationMode !== "shadow") return;
    try {
      await this.prepare(action, ip, principal, request);
    } catch {
      getLogger("BlacklistMutationIam", LogCategory.SECURITY).warn("Blacklist mutation IAM shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
  }
  async create(body: CreateIPBlacklistDto, request: TypedRequest) {
    const parsed = createIPBlacklistBodySchema.strict().safeParse(body);
    if (!parsed.success)
      throw new BadRequestError("Invalid blacklist creation", undefined, { messageKey: "errors.badRequest" });
    const { ipAddress: ip, duration } = parsed.data,
      reason = parsed.data.reason || "手动封禁",
      principal = this.identity(ip, request),
      action = "quyan:system:ip_blacklist:CreateBlacklist";
    const expireTime = duration === -1 ? new Date("2099-12-31") : new Date(Date.now() + duration * 1000);
    if (!Number.isFinite(expireTime.getTime()) || expireTime.getUTCFullYear() > 9999)
      throw new BadRequestError("Invalid ban duration", undefined, { messageKey: "errors.badRequest" });
    if (env.security.iamAuthorizationMode !== "enforce") {
      await this.legacyPermission(principal, Permission.IP_BLACKLIST_CREATE);
      await this.shadow(action, ip, principal, request);
      return this.reports.manualBan(ip, duration, reason, principal.subjectUserId, request);
    }
    const prepared = await this.prepare(action, ip, principal, request),
      row = await this.repository.create(prepared.target, { ipAddress: ip, reason, expireTime }, prepared.guard);
    await this.reports.logManualBan(ip, duration, reason, principal.subjectUserId, request);
    return row;
  }
  async remove(ip: string, request: TypedRequest) {
    const principal = this.identity(ip, request),
      action = "quyan:system:ip_blacklist:DeleteBlacklist";
    if (env.security.iamAuthorizationMode !== "enforce") {
      await this.legacyPermission(principal, Permission.IP_BLACKLIST_DELETE);
      await this.shadow(action, ip, principal, request);
      const deleted = await this.reports.unban(ip, principal.subjectUserId, request);
      if (!deleted)
        throw new NotFoundError("IP blacklist record not found", undefined, {
          messageKey: "ipBlacklist.recordNotFound",
        });
      return deleted;
    }
    const prepared = await this.prepare(action, ip, principal, request);
    if (!prepared.target) throw iamAccountDenied();
    const result = await this.repository.remove(prepared.target, prepared.guard);
    if (result) await this.reports.logManualUnban(ip, principal.subjectUserId, request);
    return result;
  }
}

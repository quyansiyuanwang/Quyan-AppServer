import { performance } from "node:perf_hooks";
import { buildAcsResource, Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { remoteTerminalSessionArn, isRemoteTerminalId } from "@/iam/resources/remote-terminal-resources";
import { RemoteTerminalGatewayService } from "@/modules/remote-terminal/gateway/gateway.service";
import type { RemoteTerminalSessionGateway } from "@/modules/remote-terminal/gateway/session-gateway";
import type { TerminalSessionMetadata } from "@/services/infrastructure/remote-terminal-session-projection";
import {
  RemoteTerminalUsageRepository,
  type TerminalUsageStore,
} from "@/store/remote-terminal-product/remote-terminal-usage.repository";
import { terminalDeviceDenied as iamAccountDenied } from "@/store/remote-terminal-product/remote-terminal-device-snapshot";
import { PermissionService } from "@/services/users/permission.service";
import {
  REMOTE_TERMINAL_PROTOCOL_SHELL_TYPES,
  type RemoteTerminalSessionSummary,
} from "@/modules/remote-terminal/protocol";
import type { RemoteTerminalUsageSummaryDto } from "@/api/dto/remote-terminal/remote-terminal.dto";
import type { TypedRequest } from "@/types/express";
import { getLogger, LogCategory } from "@/util/logger";
type SessionAction = "quyan:remote_terminal:ListSessions" | "quyan:remote_terminal:GetUsageSummary";
export class RemoteTerminalSessionReadIamService {
  private static instance: RemoteTerminalSessionReadIamService;
  constructor(
    private readonly sessions: Pick<
      RemoteTerminalSessionGateway,
      "listSessionMetadata" | "hydrateSessionSummaries"
    > = RemoteTerminalGatewayService.getInstance().getSessionGateway(),
    private readonly usage: TerminalUsageStore = RemoteTerminalUsageRepository.getInstance(),
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new RemoteTerminalSessionReadIamService());
  }
  private mode() {
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    return mode;
  }
  private identity(userId: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (
      !request ||
      !principal ||
      request.oauthAccessToken ||
      !isRemoteTerminalId(userId) ||
      principal.subjectUserId !== userId ||
      principal.principalUserId !== userId
    )
      throw iamAccountDenied();
    return { request, principal: { ...principal } };
  }
  private async legacy(userId: string, request?: TypedRequest) {
    if (!request) return;
    const { principal } = this.identity(userId, request);
    if (
      !(
        await this.permissions.checkUserPermissions(userId, [Permission.REMOTE_TERMINAL_SESSION_READ], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
  }
  private warn(action: SessionAction) {
    getLogger("RemoteTerminalSessionIam", LogCategory.SECURITY).warn("IAM terminal session shadow denied", {
      action,
      reason: "iam-resource-unavailable",
    });
  }
  private async policyGuard(userId: string, request: TypedRequest, principal: IamPrincipal) {
    const fingerprint = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
    return async () => {
      if (
        JSON.stringify(this.identity(userId, request).principal) !== JSON.stringify(principal) ||
        fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== fingerprint
      )
        throw iamAccountDenied();
    };
  }
  private async allowed(
    request: TypedRequest,
    principal: IamPrincipal,
    action: SessionAction,
    resources: readonly string[],
  ) {
    if (!resources.length) return new Set<string>();
    if (resources.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) throw iamAccountDenied();
    const start = performance.now(),
      results = await this.iam.authorizeMany({
        principal,
        action,
        resources: [...resources],
        context: requestConditionContext(request, principal),
      });
    if (
      !Array.isArray(results) ||
      results.length !== resources.length ||
      results.some((row) => !row || !["Allow", "ImplicitDeny", "ExplicitDeny"].includes(row.decision))
    )
      throw iamAccountDenied();
    const decisions = (request.iamDecisions ??= []);
    decisions.splice(0, Math.max(0, decisions.length + results.length - IAM_AUTHORIZATION_LIMITS.resourcesPerRequest));
    results.forEach((result, index) => {
      decisions.push({ ...result, action, resource: resources[index] });
      auditIamDecision({
        requestId: request.res?.locals.requestId,
        principal,
        action,
        resource: resources[index],
        result,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: this.mode() === "shadow" ? "shadow" : "enforce",
        ...(this.mode() === "shadow" ? { legacyAllowed: true } : {}),
        batchSize: resources.length,
        batchIndex: index,
      });
    });
    return new Set(resources.filter((_, index) => results[index].decision === "Allow"));
  }
  private validateMetadata(userId: string, rows: readonly TerminalSessionMetadata[]) {
    if (
      !Array.isArray(rows) ||
      new Set(rows.map((row) => row.sessionId)).size !== rows.length ||
      rows.some(
        (row) =>
          row.ownerUserId !== userId ||
          ![row.sessionId, row.deviceId, row.entitlementId].every(isRemoteTerminalId) ||
          !["pending", "connected", "closed"].includes(row.status) ||
          !/^(redis:[a-f0-9]{40}|live:[a-f0-9]{64})$/.test(row.revision),
      )
    )
      throw iamAccountDenied();
  }
  private async hydrate(userId: string, targets: readonly TerminalSessionMetadata[]) {
    if (!targets.length) return [];
    const rows = await this.sessions.hydrateSessionSummaries(userId, targets);
    if (
      !Array.isArray(rows) ||
      rows.length !== targets.length ||
      rows.some(
        (row, index) =>
          !row ||
          row.sessionId !== targets[index].sessionId ||
          row.deviceId !== targets[index].deviceId ||
          row.status !== targets[index].status ||
          row.mode !== "shell" ||
          !REMOTE_TERMINAL_PROTOCOL_SHELL_TYPES.includes(row.shellType) ||
          typeof row.createdAt !== "string" ||
          !Number.isFinite(Date.parse(row.createdAt)) ||
          new Date(row.createdAt).toISOString() !== row.createdAt,
      )
    )
      throw iamAccountDenied();
    return rows.map((row) => ({
      sessionId: row.sessionId,
      deviceId: row.deviceId,
      mode: row.mode,
      shellType: row.shellType,
      status: row.status,
      createdAt: row.createdAt,
    }));
  }
  async list(userId: string, request: TypedRequest | undefined, legacy: () => Promise<RemoteTerminalSessionSummary[]>) {
    if (this.mode() !== "enforce") {
      await this.legacy(userId, request);
      if (this.mode() === "shadow" && request) {
        try {
          await this.nativeList(userId, request);
        } catch {
          this.warn("quyan:remote_terminal:ListSessions");
        }
      }
      return legacy();
    }
    return this.nativeList(userId, request);
  }
  private async nativeList(userId: string, request?: TypedRequest) {
    const { request: trusted, principal } = this.identity(userId, request),
      guard = await this.policyGuard(userId, trusted, principal);
    const rows = await this.sessions.listSessionMetadata(userId);
    this.validateMetadata(userId, rows);
    const selected: TerminalSessionMetadata[] = [],
      items: RemoteTerminalSessionSummary[] = [];
    for (let offset = 0; offset < rows.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = rows.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
        resources = batch.map((row) => remoteTerminalSessionArn(principal.accountOwnerId, userId, row.sessionId));
      const allowed = await this.allowed(trusted, principal, "quyan:remote_terminal:ListSessions", resources);
      const admitted = batch.filter((_, index) => allowed.has(resources[index]));
      await guard();
      const admittedResources = admitted.map((row) =>
        remoteTerminalSessionArn(principal.accountOwnerId, userId, row.sessionId),
      );
      if (
        (await this.allowed(trusted, principal, "quyan:remote_terminal:ListSessions", admittedResources)).size !==
        admitted.length
      )
        throw iamAccountDenied();
      items.push(...(await this.hydrate(userId, admitted)));
      selected.push(...admitted);
    }
    // Recheck source and Condition immediately before release, including grants revoked during hydration.
    for (let offset = 0; offset < selected.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = selected.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      if (
        (
          await this.allowed(
            trusted,
            principal,
            "quyan:remote_terminal:ListSessions",
            batch.map((row) => remoteTerminalSessionArn(principal.accountOwnerId, userId, row.sessionId)),
          )
        ).size !== batch.length
      )
        throw iamAccountDenied();
      await this.hydrate(userId, batch);
      if (
        (
          await this.allowed(
            trusted,
            principal,
            "quyan:remote_terminal:ListSessions",
            batch.map((row) => remoteTerminalSessionArn(principal.accountOwnerId, userId, row.sessionId)),
          )
        ).size !== batch.length
      )
        throw iamAccountDenied();
    }
    await guard();
    return items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  async getUsage(
    userId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<RemoteTerminalUsageSummaryDto>,
  ) {
    if (this.mode() !== "enforce") {
      await this.legacy(userId, request);
      if (this.mode() === "shadow" && request) {
        try {
          await this.nativeUsage(userId, request);
        } catch {
          this.warn("quyan:remote_terminal:GetUsageSummary");
        }
      }
      return legacy();
    }
    return this.nativeUsage(userId, request);
  }
  private async nativeUsage(userId: string, request?: TypedRequest): Promise<RemoteTerminalUsageSummaryDto> {
    const { request: trusted, principal } = this.identity(userId, request),
      guard = await this.policyGuard(userId, trusted, principal),
      action = "quyan:remote_terminal:GetUsageSummary";
    const resource = buildAcsResource({
      service: "quyan",
      region: "*",
      accountId: principal.accountOwnerId,
      path: "user/" + userId,
    });
    if (!(await this.allowed(trusted, principal, action, [resource])).has(resource)) throw iamAccountDenied();
    const totals = await this.usage.totals(principal),
      rows = await this.sessions.listSessionMetadata(userId);
    this.validateMetadata(userId, rows);
    if (Object.values(totals).some((value) => !Number.isSafeInteger(value) || value < 0)) throw iamAccountDenied();
    const activeSessionCount = rows.filter((row) => row.status !== "closed").length;
    await guard();
    if (!(await this.allowed(trusted, principal, action, [resource])).has(resource)) throw iamAccountDenied();
    return {
      ...totals,
      activeSessionCount,
      remainingTerminalCount: Math.max(0, totals.totalTerminalLimit - activeSessionCount),
      remainingDeviceCount: Math.max(0, totals.totalDeviceLimit - totals.activeDeviceCount),
      terminalQuotaReached: totals.totalTerminalLimit <= 0 || activeSessionCount >= totals.totalTerminalLimit,
      deviceQuotaReached: totals.totalDeviceLimit <= 0 || totals.activeDeviceCount >= totals.totalDeviceLimit,
    };
  }
}

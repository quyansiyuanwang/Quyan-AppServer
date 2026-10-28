import { performance } from "node:perf_hooks";
import { Permission, iamLegacyPermissionsForAction, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { isRemoteTerminalId, remoteTerminalDeviceArn } from "@/iam/resources/remote-terminal-resources";
import { RemoteTerminalDeviceReadRepository } from "@/store/remote-terminal-product/remote-terminal-device-read.repository";
import type {
  RemoteTerminalDeviceReadStore,
  RemoteTerminalDeviceTarget,
} from "@/store/remote-terminal-product/remote-terminal-device-read.store";
import {
  terminalDeviceDenied as iamAccountDenied,
  assertTerminalDeviceTargets,
} from "@/store/remote-terminal-product/remote-terminal-device-snapshot";
import { PermissionService } from "@/services/users/permission.service";
import type { RemoteTerminalDeviceSummary } from "@/modules/remote-terminal/protocol";
import type { TypedRequest } from "@/types/express";
import { getLogger, LogCategory } from "@/util/logger";

import { RemoteTerminalDeviceProbeRepository } from "@/store/remote-terminal-product/remote-terminal-device-probe.repository";
import type { RemoteTerminalDeviceProbeStore } from "@/store/remote-terminal-product/remote-terminal-device-probe.store";
import type { RemoteTerminalDeviceProbeResponse } from "@/modules/remote-terminal/protocol";

export type TerminalDeviceGuard = () => Promise<void>;
type DeviceAction =
  | "quyan:remote_terminal:BrowseDirectories"
  | "quyan:remote_terminal:GetAgentPreferences"
  | "quyan:remote_terminal:UpdateAgentPreferences"
  | "quyan:remote_terminal:CreateSession";
const probePolicy = Object.freeze({ concurrency: 8 });
export class RemoteTerminalDeviceIamService {
  private static instance: RemoteTerminalDeviceIamService;
  constructor(
    private readonly repository: RemoteTerminalDeviceReadStore = RemoteTerminalDeviceReadRepository.getInstance(),
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
    private readonly probes: RemoteTerminalDeviceProbeStore = RemoteTerminalDeviceProbeRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new RemoteTerminalDeviceIamService());
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
  private async legacy(userId: string, request?: TypedRequest, action?: string) {
    if (!request) return;
    const { principal } = this.identity(userId, request);
    if (
      !(
        await this.permissions.checkUserPermissions(
          userId,
          action ? iamLegacyPermissionsForAction(action) : [Permission.REMOTE_TERMINAL_DEVICE_READ],
          {
            assumedRoleSessionId: principal.roleSessionId,
          },
        )
      ).hasPermission
    )
      throw iamAccountDenied();
  }
  private mode() {
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    return mode;
  }
  private warn(action: string) {
    getLogger("RemoteTerminalIamBridge", LogCategory.SECURITY).warn("IAM terminal operation shadow denied", {
      action,
      reason: "iam-resource-unavailable",
    });
  }
  private async allowed(request: TypedRequest, principal: IamPrincipal, action: string, resources: readonly string[]) {
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
      resources.some((_, i) => !results[i] || !["Allow", "ExplicitDeny", "ImplicitDeny"].includes(results[i].decision))
    )
      throw iamAccountDenied();
    const records = (request.iamDecisions ??= []);
    records.splice(0, Math.max(0, records.length + results.length - IAM_AUTHORIZATION_LIMITS.resourcesPerRequest));
    results.forEach((result, index) => {
      records.push({ ...result, action, resource: resources[index] });
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
    return new Set(resources.filter((_, i) => results[i].decision === "Allow"));
  }
  private async policyGuard(userId: string, request: TypedRequest, principal: IamPrincipal) {
    const hash = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
    return async () => {
      const current = this.identity(userId, request).principal;
      if (
        JSON.stringify(current) !== JSON.stringify(principal) ||
        fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== hash
      )
        throw iamAccountDenied();
    };
  }
  private validateTargets(principal: IamPrincipal, targets: readonly RemoteTerminalDeviceTarget[]) {
    if (
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(targets.map((row) => row.deviceId)).size !== targets.length ||
      targets.some(
        (row) =>
          row.userId !== principal.subjectUserId ||
          !isRemoteTerminalId(row.id) ||
          !isRemoteTerminalId(row.deviceId) ||
          !/^[a-f0-9]{64}$/.test(row.controlRevision) ||
          !/^[a-f0-9]{64}$/.test(row.summaryRevision),
      )
    )
      throw iamAccountDenied();
  }
  async list(userId: string, request: TypedRequest | undefined, legacy: () => Promise<RemoteTerminalDeviceSummary[]>) {
    const mode = this.mode();
    if (mode !== "enforce") {
      await this.legacy(userId, request);
      if (mode === "shadow" && request) {
        try {
          await this.nativeList(userId, request);
        } catch {
          this.warn("quyan:remote_terminal:ListDevices");
        }
      }
      return legacy();
    }
    return this.nativeList(userId, request);
  }
  private async nativeList(userId: string, request?: TypedRequest): Promise<RemoteTerminalDeviceSummary[]> {
    const identity = this.identity(userId, request),
      { principal } = identity,
      trusted = identity.request;
    const policyGuard = await this.policyGuard(userId, trusted, principal),
      action = "quyan:remote_terminal:ListDevices";
    let after: string | undefined;
    const seen = new Set<string>(),
      selected: RemoteTerminalDeviceTarget[] = [],
      items: RemoteTerminalDeviceSummary[] = [];
    while (true) {
      const targets = await this.repository.scan(principal, after);
      this.validateTargets(principal, targets);
      if (!targets.length) break;
      for (const target of targets) {
        if (seen.has(target.id) || (after && target.id <= after)) throw iamAccountDenied();
        seen.add(target.id);
        after = target.id;
      }
      const resources = targets.map((row) => remoteTerminalDeviceArn(principal.accountOwnerId, userId, row.deviceId));
      const allowed = await this.allowed(trusted, principal, action, resources);
      const admitted = targets.filter((_, index) => allowed.has(resources[index]));
      await policyGuard();
      const admittedResources = admitted.map((row) =>
        remoteTerminalDeviceArn(principal.accountOwnerId, userId, row.deviceId),
      );
      if ((await this.allowed(trusted, principal, action, admittedResources)).size !== admitted.length)
        throw iamAccountDenied();
      const rows = await this.repository.hydrate(principal, admitted);
      const byId = new Map(rows.map((row) => [row.deviceId, row]));
      if (
        rows.length !== admitted.length ||
        byId.size !== admitted.length ||
        admitted.some((row) => !byId.has(row.deviceId)) ||
        rows.some((row) => "heartbeatToken" in row || "registrationToken" in row || "snapshot" in row)
      )
        throw iamAccountDenied();
      items.push(...rows);
      selected.push(...admitted);
      if (targets.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
    }
    for (let offset = 0; offset < selected.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = selected.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
        resources = batch.map((row) => remoteTerminalDeviceArn(principal.accountOwnerId, userId, row.deviceId));
      assertTerminalDeviceTargets(
        await this.repository.targets(
          principal,
          batch.map((row) => row.deviceId),
        ),
        batch,
      );
      if ((await this.allowed(trusted, principal, action, resources)).size !== batch.length) throw iamAccountDenied();
    }
    await policyGuard();
    return items.sort(
      (a, b) => Number(b.online) - Number(a.online) || Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt),
    );
  }
  private async probeTargets(userId: string, request?: TypedRequest) {
    const { principal, request: trusted } = this.identity(userId, request),
      policyGuard = await this.policyGuard(userId, trusted, principal);
    const action = "quyan:remote_terminal:ProbeDevices",
      targets: RemoteTerminalDeviceTarget[] = [];
    let after: string | undefined;
    const seen = new Set<string>();
    while (true) {
      const batch = await this.repository.scan(principal, after);
      this.validateTargets(principal, batch);
      if (!batch.length) break;
      for (const target of batch) {
        if (seen.has(target.id) || (after && target.id <= after)) throw iamAccountDenied();
        seen.add(target.id);
        after = target.id;
      }
      const resources = batch.map((row) => remoteTerminalDeviceArn(principal.accountOwnerId, userId, row.deviceId)),
        allowed = await this.allowed(trusted, principal, action, resources);
      targets.push(...batch.filter((_, index) => allowed.has(resources[index])));
      if (batch.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
    }
    await policyGuard();
    const guard = async (target: RemoteTerminalDeviceTarget) => {
      await policyGuard();
      assertTerminalDeviceTargets(await this.repository.targets(principal, [target.deviceId]), [target], false);
      if (
        !(
          await this.allowed(trusted, principal, action, [
            remoteTerminalDeviceArn(principal.accountOwnerId, userId, target.deviceId),
          ])
        ).size
      )
        throw iamAccountDenied();
    };
    return { principal, targets, guard, policyGuard };
  }
  async probe(
    userId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<RemoteTerminalDeviceProbeResponse>,
    dispatch: (deviceId: string, guard: TerminalDeviceGuard) => Promise<Date | null>,
  ): Promise<RemoteTerminalDeviceProbeResponse> {
    const mode = this.mode();
    if (mode !== "enforce") {
      await this.legacy(userId, request);
      if (mode === "shadow" && request) {
        try {
          await this.probeTargets(userId, request);
        } catch {
          this.warn("quyan:remote_terminal:ProbeDevices");
        }
      }
      return legacy();
    }
    const selection = await this.probeTargets(userId, request),
      authorizationRevision = await this.probes.revision(selection.principal),
      items: RemoteTerminalDeviceProbeResponse["items"] = [];
    for (let offset = 0; offset < selection.targets.length; offset += probePolicy.concurrency) {
      const batch = selection.targets.slice(offset, offset + probePolicy.concurrency);
      const pongs = await Promise.all(
        batch.map(async (target) => {
          const recheck = () => selection.guard(target);
          await recheck();
          const pongAt = await dispatch(target.deviceId, recheck);
          await recheck();
          return pongAt;
        }),
      );
      for (let index = 0; index < batch.length; index++) {
        const target = batch[index]!,
          recheck = () => selection.guard(target);
        items.push(
          await this.probes.record(
            { principal: selection.principal, target, authorizationRevision, recheck },
            pongs[index]!,
          ),
        );
      }
    }
    for (const target of selection.targets) await selection.guard(target);
    await selection.policyGuard();
    return { items };
  }
  private async deviceGuard(
    userId: string,
    deviceId: string,
    action: DeviceAction,
    request?: TypedRequest,
  ): Promise<TerminalDeviceGuard> {
    const identity = this.identity(userId, request),
      { principal } = identity,
      trusted = identity.request;
    if (!isRemoteTerminalId(deviceId)) throw iamAccountDenied();
    const targets = await this.repository.targets(principal, [deviceId]);
    this.validateTargets(principal, targets);
    if (targets.length !== 1 || targets[0].deviceId !== deviceId) throw iamAccountDenied();
    const resource = remoteTerminalDeviceArn(principal.accountOwnerId, userId, deviceId),
      policies = await this.policyGuard(userId, trusted, principal);
    const guard = async () => {
      await policies();
      assertTerminalDeviceTargets(await this.repository.targets(principal, [deviceId]), targets, false);
      if (!(await this.allowed(trusted, principal, action, [resource])).has(resource)) throw iamAccountDenied();
    };
    await guard();
    return guard;
  }
  async withDevice<T>(
    userId: string,
    deviceId: string,
    action: DeviceAction,
    request: TypedRequest | undefined,
    read: (guard?: TerminalDeviceGuard) => Promise<T>,
  ): Promise<T> {
    const mode = this.mode();
    if (mode === "legacy" || (mode === "shadow" && !request)) {
      await this.legacy(userId, request, action);
      return read();
    }
    if (mode === "shadow") {
      await this.legacy(userId, request, action);
      let guard: TerminalDeviceGuard | undefined;
      try {
        guard = await this.deviceGuard(userId, deviceId, action, request);
      } catch {
        this.warn(action);
      }
      const check = async () => {
        if (guard) {
          try {
            await guard();
          } catch {
            this.warn(action);
          }
        }
      };
      const result = await read(check);
      await check();
      return result;
    }
    const guard = await this.deviceGuard(userId, deviceId, action, request),
      result = await read(guard);
    await guard();
    return result;
  }
}

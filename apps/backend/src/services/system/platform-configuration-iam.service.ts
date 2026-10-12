import { performance } from "node:perf_hooks";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import {
  platformConfigurationArn,
  isRegisteredConfigurationKey,
  isSupportConfigurationKey,
} from "@/iam/resources/platform-configuration-resources";
import { supportConfigArn } from "@/iam/resources/support-config-resource";
import { IamAccountUserRepository, iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformConfigurationRepository } from "@/store/system/platform-configuration.repository";
import type {
  ConfigurationTarget,
  PlatformConfigurationAction,
  PlatformConfigurationGuard,
  PlatformConfigurationStore,
} from "@/store/system/platform-configuration.store";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { CONFIG_KEYS } from "@/constant/config-keys";
import {
  isSensitiveServerConfigValue,
  SERVER_CONFIG_SECRET_PLACEHOLDER,
  type IamPrincipal,
  type IamEvaluationResult,
} from "@quyan/shared";
import { ForbiddenError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
export class PlatformConfigurationIamService {
  private static instance: PlatformConfigurationIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformConfigurationStore = PlatformConfigurationRepository.getInstance(),
    private readonly users = IamAccountUserRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformConfigurationIamService());
  }
  private async identity(request?: TypedRequest, userId?: string) {
    const principal = request && getIamPrincipal(request);
    if (
      !request ||
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== principal.principalUserId ||
      (userId !== undefined && principal.subjectUserId !== userId)
    )
      throw iamAccountDenied();
    await this.iam.loadPolicies(principal);
    return { principal: { ...principal }, request };
  }
  private audit(
    principal: IamPrincipal,
    request: TypedRequest,
    action: string,
    resource: string,
    result: IamEvaluationResult,
    start: number,
  ) {
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
  }
  private async allowed(
    principal: IamPrincipal,
    request: TypedRequest,
    action: PlatformConfigurationAction,
    keys: readonly string[],
  ) {
    if (!keys.length) return new Set<string>();
    if (
      keys.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      keys.some((key) => !isRegisteredConfigurationKey(key))
    )
      throw iamAccountDenied();
    const start = performance.now(),
      resources = keys.map(platformConfigurationArn);
    const results = await this.iam.authorizeMany({
      principal,
      action,
      resources,
      context: requestConditionContext(request, principal),
    });
    if (!Array.isArray(results) || results.length !== keys.length || results.some((r) => !r)) throw iamAccountDenied();
    results.forEach((r, i) => this.audit(principal, request, action, resources[i], r, start));
    let supportAllowed = true;
    if (keys.some(isSupportConfigurationKey)) {
      const supportAction =
        action === "quyan:system:ListConfigurations" ? "quyan:support:GetConfig" : "quyan:support:UpdateConfig";
      const resource = supportConfigArn();
      try {
        const result = await this.iam.authorize({
          principal,
          action: supportAction,
          resource,
          context: requestConditionContext(request, principal),
        });
        if (!result) throw iamAccountDenied();
        this.audit(principal, request, supportAction, resource, result, start);
        supportAllowed = result.decision === "Allow";
      } catch (error) {
        if (!(error instanceof ForbiddenError)) throw error;
        supportAllowed = false;
      }
    }
    return new Set(
      keys.filter((key, i) => results[i].decision === "Allow" && (!isSupportConfigurationKey(key) || supportAllowed)),
    );
  }
  private async guard(
    action: PlatformConfigurationAction,
    keys: readonly string[],
    targets: readonly ConfigurationTarget[],
    principal: IamPrincipal,
    request: TypedRequest,
  ) {
    const group = await this.repository.groupSnapshot(principal),
      ids = [...new Set([principal.subjectUserId, principal.accountOwnerId])];
    const users = await this.users.targets(principal, ids);
    if (
      users.length !== ids.length ||
      ids.some(
        (id) =>
          !users.some((u) => u.id === id && u.updateTime instanceof Date && Number.isFinite(u.updateTime.getTime())),
      )
    )
      throw iamAccountDenied();
    const recheck = async () => {
      if ((await this.allowed(principal, request, action, keys)).size !== keys.length) throw iamAccountDenied();
    };
    const guard: PlatformConfigurationGuard = {
      action,
      keys: [...keys],
      targets,
      group,
      users: { principal, targetUserId: principal.subjectUserId, users, recheck },
    };
    return guard;
  }
  async prepareUpdate(keys: readonly string[], userId: string, request?: TypedRequest) {
    if (
      !keys.length ||
      keys.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(keys).size !== keys.length ||
      keys.some((key) => !isRegisteredConfigurationKey(key))
    )
      throw iamAccountDenied();
    const identity = await this.identity(request, userId),
      { principal } = identity;
    await this.repository.groupSnapshot(principal);
    if (
      (await this.allowed(principal, identity.request, "quyan:system:UpdateConfigurations", keys)).size !== keys.length
    )
      throw iamAccountDenied();
    const targets = await this.repository.targets(principal, keys);
    return this.guard("quyan:system:UpdateConfigurations", keys, targets, principal, identity.request);
  }
  async prepareRead(keys: readonly string[], request?: TypedRequest) {
    if (
      !keys.length ||
      keys.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(keys).size !== keys.length ||
      keys.some((key) => !isRegisteredConfigurationKey(key))
    )
      throw iamAccountDenied();
    const identity = await this.identity(request),
      { principal } = identity;
    await this.repository.groupSnapshot(principal);
    if ((await this.allowed(principal, identity.request, "quyan:system:ListConfigurations", keys)).size !== keys.length)
      throw iamAccountDenied();
    const targets = await this.repository.targets(principal, keys);
    return this.guard("quyan:system:ListConfigurations", keys, targets, principal, identity.request);
  }
  recheck(guard: PlatformConfigurationGuard) {
    return this.repository.recheck(guard);
  }
  update(updates: Readonly<Record<string, string>>, guard: PlatformConfigurationGuard) {
    return this.repository.update(updates, guard);
  }
  async list(request?: TypedRequest, hydrate = true) {
    const identity = await this.identity(request),
      { principal } = identity;
    await this.repository.groupSnapshot(principal);
    const targets: ConfigurationTarget[] = [];
    let after: string | undefined;
    for (;;) {
      const batch = await this.repository.scan(principal, after);
      if (
        batch.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        batch.some(
          (t, i) =>
            t.status !== 1 ||
            !isRegisteredConfigurationKey(t.key) ||
            (i ? t.key <= batch[i - 1].key : after !== undefined && t.key <= after),
        )
      )
        throw iamAccountDenied();
      const allow = await this.allowed(
        principal,
        identity.request,
        "quyan:system:ListConfigurations",
        batch.map((t) => t.key),
      );
      targets.push(...batch.filter((t) => allow.has(t.key)));
      if (batch.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
      after = batch[batch.length - 1].key;
    }
    // AI settings may still use bootstrap defaults when no persisted row exists.
    const aiResourcesAllowed = (
      await this.allowed(principal, identity.request, "quyan:system:ListConfigurations", [CONFIG_KEYS.AI_RESOURCES])
    ).has(CONFIG_KEYS.AI_RESOURCES);
    if (!hydrate) return { configs: {}, aiResourcesAllowed: false };
    const configs: Record<string, string> = {};
    const guards: PlatformConfigurationGuard[] = [];
    for (let i = 0; i < targets.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      const guard = await this.guard(
        "quyan:system:ListConfigurations",
        batch.map((t) => t.key),
        batch,
        principal,
        identity.request,
      );
      await guard.users.recheck();
      const rows = await this.repository.hydrate(principal, batch);
      if (
        rows.length !== batch.length ||
        rows.some(
          (r) =>
            !batch.some((t) => t.id === r.id && t.key === r.key && t.updateTime.getTime() === r.updateTime.getTime()),
        )
      )
        throw iamAccountDenied();
      await this.repository.recheck(guard);
      guards.push(guard);
      rows.forEach((row) => {
        configs[row.key] =
          isSensitiveServerConfigValue(row.key, row.value) && row.value ? SERVER_CONFIG_SECRET_PLACEHOLDER : row.value;
      });
    }
    for (const guard of guards) await this.repository.recheck(guard);
    await this.repository.groupSnapshot(principal);
    if (
      aiResourcesAllowed &&
      !(
        await this.allowed(principal, identity.request, "quyan:system:ListConfigurations", [CONFIG_KEYS.AI_RESOURCES])
      ).has(CONFIG_KEYS.AI_RESOURCES)
    )
      throw iamAccountDenied();
    return { configs, aiResourcesAllowed };
  }
}

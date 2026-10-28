import { performance } from "node:perf_hooks";
import { iamLegacyPermissionsForAction, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import type { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IAM_AUTHORIZATION_LIMITS, isSafeIamResourceBatch } from "@/iam/authorization-limits";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
export interface PlatformResourceReadGuard {
  allowed(resources: readonly string[]): Promise<Set<string>>;
  recheck(): Promise<void>;
  trackSource(check: () => Promise<void>): void;
}
/** Authorize a logical collection before reading its source, and recheck every contributing grant before return. */
export class PlatformResourceReadIamService {
  constructor(
    private readonly iam: Pick<IamAuthorizationService, "loadPolicies" | "authorizeMany">,
    private readonly snapshots: PlatformManagementReadStore,
  ) {}
  async read<T>(
    action: string,
    identity: IamPrincipal,
    request: TypedRequest,
    boundary: string,
    consume: (guard: PlatformResourceReadGuard) => Promise<T>,
  ): Promise<T> {
    const principal = { ...identity },
      required = iamLegacyPermissionsForAction(action);
    if (!required.length || principal.subjectUserId !== principal.principalUserId) throw iamAccountDenied();
    const snapshot = await this.snapshots.snapshot(principal, required);
    const hash = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
    const contributing = new Set<string>();
    const sourceChecks: (() => Promise<void>)[] = [];
    const allowed = async (resources: readonly string[]) => {
      const values = [...new Set(resources)],
        admitted = new Set<string>();
      for (let i = 0; i < values.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
        const batch = values.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
        if (!isSafeIamResourceBatch(batch)) throw iamAccountDenied();
        const start = performance.now(),
          results = await this.iam.authorizeMany({
            principal,
            action,
            resources: batch,
            context: requestConditionContext(request, principal),
          });
        if (
          !Array.isArray(results) ||
          results.length !== batch.length ||
          results.some((result) => !result || !["Allow", "ExplicitDeny", "ImplicitDeny"].includes(result.decision))
        )
          throw iamAccountDenied();
        const records = (request.iamDecisions ??= []);
        records.splice(0, Math.max(0, records.length + results.length - IAM_AUTHORIZATION_LIMITS.resourcesPerRequest));
        results.forEach((result, index) => {
          const resource = batch[index]!;
          records.push({ ...result, action, resource });
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
          if (result.decision === "Allow") {
            admitted.add(resource);
            contributing.add(resource);
          }
        });
      }
      return admitted;
    };
    const recheck = async () => {
      await this.snapshots.recheck(principal, required, snapshot);
      if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== hash) throw iamAccountDenied();
      const resources = [...contributing];
      if ((await allowed(resources)).size !== resources.length) throw iamAccountDenied();
      for (const check of sourceChecks) await check();
    };
    if (!(await allowed([boundary])).has(boundary)) throw iamAccountDenied();
    await recheck();
    const result = await consume({ allowed, recheck, trackSource: (check) => sourceChecks.push(check) });
    await recheck();
    return result;
  }
}

import { performance } from "node:perf_hooks";
import { buildAcsResource, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { requestConditionContext } from "@/iam/request/condition-context";
import { getIamPrincipal } from "@/iam/request/principal-context";
import {
  isCanonicalPasskeyCredentialId,
  isCanonicalPasskeyResourceId,
  passkeyArn,
} from "@/iam/resources/passkey-resources";
import { PasskeyManagementRepository, passkeyDenied } from "@/store/auth/passkey-management.repository";
import type { PasskeyManagementStore, PasskeyTarget } from "@/store/auth/passkey-management.store";
import type { TypedRequest } from "@/types/express";
import type { PasskeyCredentialItem } from "@/api/dto/users/passkey.dto";
export class PasskeyIamService {
  private static instance: PasskeyIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PasskeyManagementStore = PasskeyManagementRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PasskeyIamService());
  }
  private async actor(userId: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (
      !request ||
      !principal ||
      !isCanonicalPasskeyResourceId(userId) ||
      principal.subjectUserId !== userId ||
      principal.principalUserId !== userId
    )
      throw passkeyDenied();
    await this.iam.loadPolicies(principal);
    const snapshot = await this.repository.actor(principal);
    if (snapshot.id !== userId) throw passkeyDenied();
    return { request, principal, snapshot };
  }
  private async allowed(request: TypedRequest, principal: IamPrincipal, action: string, resources: readonly string[]) {
    if (!resources.length) return [];
    const start = performance.now();
    const results = await this.iam.authorizeMany({
      principal,
      action,
      resources: [...resources],
      context: requestConditionContext(request, principal),
    });
    if (!Array.isArray(results) || results.length !== resources.length || resources.some((_, index) => !results[index]))
      throw passkeyDenied();
    results.forEach((result, index) => {
      (request.iamDecisions ??= []).push({ ...result, action, resource: resources[index] });
      auditIamDecision({
        requestId: request.res?.locals.requestId,
        principal,
        action,
        resource: resources[index],
        result,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
        ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
      });
    });
    return resources.filter((_, index) => results[index].decision === "Allow");
  }
  async authorizeRegistration(
    userId: string,
    action: "quyan:auth:GetPasskeyRegistrationOptions" | "quyan:auth:RegisterPasskey",
    request?: TypedRequest,
  ) {
    const identity = await this.actor(userId, request);
    const resource = buildAcsResource({
      service: "quyan",
      region: "*",
      accountId: identity.principal.accountOwnerId,
      path: "user/" + userId,
    });
    if ((await this.allowed(identity.request, identity.principal, action, [resource])).length !== 1)
      throw passkeyDenied();
    return identity;
  }
  async list(userId: string, request?: TypedRequest): Promise<PasskeyCredentialItem[]> {
    const { request: trusted, principal } = await this.actor(userId, request);
    let after: PasskeyTarget | undefined;
    const seen = new Set<string>(),
      items: PasskeyCredentialItem[] = [];
    while (true) {
      const targets = await this.repository.scan(principal, after);
      if (!targets.length) break;
      if (
        targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        targets.some((target, index) => {
          const previous = index ? targets[index - 1] : after;
          return (
            target.userId !== userId ||
            !isCanonicalPasskeyResourceId(target.id) ||
            seen.has(target.id) ||
            (previous &&
              (target.createTime > previous.createTime ||
                (target.createTime.getTime() === previous.createTime.getTime() && target.id >= previous.id)))
          );
        })
      )
        throw passkeyDenied();
      targets.forEach((t) => seen.add(t.id));
      const resource = (target: { id: string }) => passkeyArn(principal.accountOwnerId, userId, target.id);
      const allowed = new Set(await this.allowed(trusted, principal, "quyan:auth:ListPasskeys", targets.map(resource)));
      const selected = targets.filter((t) => allowed.has(resource(t)));
      const rows = await this.repository.hydrate(principal, selected);
      if (rows.some((row) => !selected.some((t) => t.id === row.id))) throw passkeyDenied();
      const final = new Set(await this.allowed(trusted, principal, "quyan:auth:ListPasskeys", rows.map(resource)));
      items.push(...rows.filter((row) => final.has(resource(row))));
      after = targets[targets.length - 1];
      if (targets.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
    }
    // A policy may change during a multi-page read; recheck every returned row.
    for (let offset = 0; offset < items.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const chunk = items.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      const final = new Set(
        await this.allowed(
          trusted,
          principal,
          "quyan:auth:ListPasskeys",
          chunk.map((row) => passkeyArn(principal.accountOwnerId, userId, row.id)),
        ),
      );
      chunk.forEach((row) => {
        if (!final.has(passkeyArn(principal.accountOwnerId, userId, row.id))) seen.delete(row.id);
      });
    }
    return items.filter((row) => seen.has(row.id));
  }
  async authorizeDeletion(userId: string, credentialId: string, request?: TypedRequest) {
    const { request: trusted, principal } = await this.actor(userId, request);
    if (!isCanonicalPasskeyCredentialId(credentialId)) throw passkeyDenied();
    const target = await this.repository.target(principal, credentialId);
    if (!target || target.userId !== userId || !isCanonicalPasskeyResourceId(target.id)) throw passkeyDenied();
    const resource = passkeyArn(principal.accountOwnerId, userId, target.id);
    for (let check = 0; check < 2; check++) {
      if ((await this.allowed(trusted, principal, "quyan:auth:DeletePasskey", [resource])).length !== 1)
        throw passkeyDenied();
    }
    return { principal, target };
  }
  async revoke(userId: string, credentialId: string, request?: TypedRequest) {
    const { principal, target } = await this.authorizeDeletion(userId, credentialId, request);
    await this.repository.revoke(principal, target);
  }
}

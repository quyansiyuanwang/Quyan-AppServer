import { performance } from "node:perf_hooks";
import { getIamActionDefinition, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import {
  platformLegalPolicyArn,
  platformLegalPolicyCreationArn,
} from "@/iam/resources/platform-legal-policy-resources";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformLegalPolicyWriteRepository } from "@/store/content/platform-legal-policy-write.repository";
import type {
  PlatformLegalPolicyWriteStore,
  PlatformLegalPolicyWriteGuard,
  LegalPolicyDraftOperation,
} from "@/store/content/platform-legal-policy-write.store";
import {
  createLegalPolicyBodySchema,
  updateLegalPolicyBodySchema,
} from "@/api/schema/legal-policy/legal-policy.schema";
import type { CreateLegalPolicyDto, UpdateLegalPolicyDto } from "@/api/dto/legal-policy/legal-policy.dto";
import { BadRequestError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
export class PlatformLegalPolicyWriteIamService {
  private static instance: PlatformLegalPolicyWriteIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformLegalPolicyWriteStore = PlatformLegalPolicyWriteRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformLegalPolicyWriteIamService());
  }
  private principal(userId: string, request: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== principal.principalUserId ||
      principal.subjectUserId !== userId
    )
      throw iamAccountDenied();
    return { ...principal };
  }
  private async evaluate(
    principal: IamPrincipal,
    request: TypedRequest,
    operation: LegalPolicyDraftOperation,
    resource: string,
  ) {
    const action = "quyan:legal_policy:" + operation,
      start = performance.now();
    const result = await this.iam.authorize({
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
  }
  private async guard(
    principal: IamPrincipal,
    request: TypedRequest,
    operation: LegalPolicyDraftOperation,
    resource: string,
  ) {
    const permission = getIamActionDefinition("quyan:legal_policy:" + operation)?.legacyPermission;
    if (!permission) throw iamAccountDenied();
    const snapshot = await this.identities.snapshot(principal, permission);
    await this.evaluate(principal, request, operation, resource);
    const recheck = async () => {
      await this.identities.recheck(principal, permission, snapshot);
      await this.evaluate(principal, request, operation, resource);
      await this.identities.recheck(principal, permission, snapshot);
    };
    const guard: PlatformLegalPolicyWriteGuard = {
      operation,
      permission,
      group: snapshot.group,
      users: { principal, targetUserId: principal.subjectUserId, users: snapshot.users, recheck },
      recheckVersion: (id) => this.evaluate(principal, request, operation, platformLegalPolicyArn(id)),
    };
    return guard;
  }
  async create(input: CreateLegalPolicyDto, userId: string, request: TypedRequest, persist = true) {
    const parsed = createLegalPolicyBodySchema.strict().safeParse(input);
    if (!parsed.success)
      throw new BadRequestError("Invalid legal policy draft", undefined, { messageKey: "errors.badRequest" });
    const principal = this.principal(userId, request),
      guard = await this.guard(
        principal,
        request,
        "CreateVersion",
        platformLegalPolicyCreationArn(parsed.data.policyType),
      );
    if (!persist) {
      await guard.users.recheck();
      return undefined;
    }
    return this.repository.create(parsed.data, guard);
  }
  async change(
    operation: "UpdateVersion" | "DeleteVersion",
    id: string,
    input: UpdateLegalPolicyDto,
    userId: string,
    request: TypedRequest,
    persist = true,
  ) {
    if (!["UpdateVersion", "DeleteVersion"].includes(operation)) throw iamAccountDenied();
    const parsed = operation === "UpdateVersion" ? updateLegalPolicyBodySchema.safeParse(input) : undefined;
    if (
      operation === "UpdateVersion" &&
      (!parsed?.success || Object.keys(input).some((key) => !["title", "summary", "content"].includes(key)))
    )
      throw new BadRequestError("Invalid legal policy draft", undefined, { messageKey: "errors.badRequest" });
    const principal = this.principal(userId, request),
      permission = getIamActionDefinition("quyan:legal_policy:" + operation)?.legacyPermission;
    if (!permission) throw iamAccountDenied();
    const target = await this.repository.target(principal, id, permission);
    if (!target || target.status !== 1) throw iamAccountDenied();
    const guard = await this.guard(principal, request, operation, platformLegalPolicyArn(target.id));
    if (!persist) {
      await guard.users.recheck();
      return undefined;
    }
    return operation === "UpdateVersion"
      ? this.repository.update(target, parsed!.data!, guard)
      : this.repository.remove(target, guard);
  }
}

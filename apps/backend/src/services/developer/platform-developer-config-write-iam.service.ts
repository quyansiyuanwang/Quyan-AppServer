import { performance } from "node:perf_hooks";
import { Permission, isDeveloperProductCode, type IamPrincipal, type DeveloperProductCode } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import {
  platformDeveloperConfigArn,
  platformDeveloperConfigControlArn,
  isDeveloperConfigRecordId,
} from "@/iam/resources/platform-developer-config-resources";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformDeveloperConfigWriteRepository } from "@/store/developer/platform-developer-config-write.repository";
import type {
  PlatformDeveloperConfigWriteStore,
  PlatformDeveloperConfigWriteGuard,
} from "@/store/developer/platform-developer-config-write.store";
import { updateProductConfigBodySchema } from "@/api/schema/developer/product-platform.schema";
import type { UpdateDeveloperProductConfigDto } from "@/api/dto/developer/product-platform.dto";
import { BadRequestError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
export class PlatformDeveloperConfigWriteIamService {
  private static instance: PlatformDeveloperConfigWriteIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformDeveloperConfigWriteStore = PlatformDeveloperConfigWriteRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformDeveloperConfigWriteIamService());
  }
  private principal(userId: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (
      !request ||
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== principal.principalUserId ||
      principal.subjectUserId !== userId
    )
      throw iamAccountDenied();
    return { principal: { ...principal }, request };
  }
  private async evaluate(principal: IamPrincipal, request: TypedRequest, resource: string) {
    const action = "quyan:developer:UpsertProductConfiguration",
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
  async upsert(
    product: DeveloperProductCode,
    input: UpdateDeveloperProductConfigDto,
    userId: string,
    request?: TypedRequest,
    persist = true,
  ) {
    const parsed = updateProductConfigBodySchema.strict().safeParse(input);
    if (!isDeveloperProductCode(product) || !parsed.success)
      throw new BadRequestError("Invalid product configuration", undefined, { messageKey: "errors.badRequest" });
    const identity = this.principal(userId, request),
      { principal } = identity;
    const permission = Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE;
    const snapshot = await this.identities.snapshot(principal, permission);
    const resource = platformDeveloperConfigControlArn(product);
    await this.evaluate(principal, identity.request, resource);
    const target = await this.repository.target(principal, product);
    if (
      target &&
      (target.productCode !== product ||
        !isDeveloperConfigRecordId(target.id) ||
        !(target.updateTime instanceof Date) ||
        !Number.isFinite(target.updateTime.getTime()))
    )
      throw iamAccountDenied();
    const recheck = async () => {
      await this.identities.recheck(principal, permission, snapshot);
      await this.evaluate(principal, identity.request, resource);
      await this.identities.recheck(principal, permission, snapshot);
    };
    const guard: PlatformDeveloperConfigWriteGuard = {
      permission,
      group: snapshot.group,
      users: { principal, targetUserId: userId, users: snapshot.users, recheck },
      recheckEntry: async (id) => this.evaluate(principal, identity.request, platformDeveloperConfigArn(id)),
    };
    if (target) await guard.recheckEntry(target.id);
    if (!persist) {
      await recheck();
      return undefined;
    }
    return this.repository.upsert(product, parsed.data, target, guard);
  }
}

import { Permission, CustomCode } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import {
  contentSafetySystemRuleArn,
  contentSafetySystemRuleControlArn,
  isContentSafetyRuleId,
} from "@/iam/resources/content-safety-system-resources";
import { contentSafetyRuleSchema, contentSafetyBatchUpdateSchema } from "@/api/schema/system/content-safety.schema";
import { PlatformResourceReadIamService } from "./platform-resource-read-iam.service";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { ContentSafetySystemRuleMutationRepository } from "@/store/system/content-safety-system-rule-mutation.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import type {
  ContentSafetySystemRuleMutationStore,
  ContentSafetySystemRuleMutationGuard,
  ContentSafetySystemRuleData,
} from "@/store/system/content-safety-system-rule-mutation.store";
import type { ContentSafetyRule } from "@prisma/client";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { BadRequestError, ForbiddenError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
type RuleOperation = "CreateSystemRule" | "UpdateSystemRule" | "DeleteSystemRule" | "BatchUpdateSystemRules";
export class ContentSafetySystemRuleMutationIamService {
  private static instance: ContentSafetySystemRuleMutationIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: ContentSafetySystemRuleMutationStore = ContentSafetySystemRuleMutationRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new ContentSafetySystemRuleMutationIamService());
  }
  private rule(input: unknown): ContentSafetySystemRuleData {
    const parsed = contentSafetyRuleSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestError("Invalid system rule", undefined, { messageKey: "contentSafety.invalidRule" });
    const value = parsed.data;
    return {
      name: value.name,
      type: value.type,
      pattern: value.pattern,
      direction: value.direction,
      action: value.action,
      enabled: value.enabled ?? true,
      priority: value.priority ?? 100,
    };
  }
  private async prepare(
    operation: RuleOperation,
    ids: readonly string[],
    request: TypedRequest,
    validate: () => Promise<void>,
  ) {
    const identity = getIamPrincipal(request);
    if (!identity || new Set(ids).size !== ids.length || ids.some((id) => !isContentSafetyRuleId(id)))
      throw iamAccountDenied();
    const action = "quyan:content_safety:" + operation,
      principal = { ...identity },
      resources = ids.map(contentSafetySystemRuleArn),
      boundary = operation === "CreateSystemRule" ? contentSafetySystemRuleControlArn() : resources[0];
    if (!boundary) throw iamAccountDenied();
    return new PlatformResourceReadIamService(this.iam, this.snapshots).read(
      action,
      principal,
      request,
      boundary,
      async (reader) => {
        if (resources.length && (await reader.allowed(resources)).size !== resources.length) throw iamAccountDenied();
        const targets = await this.repository.targets(ids);
        if (
          targets.length !== ids.length ||
          ids.some(
            (id) => !targets.some((row) => row.id === id && row.status === 1 && /^[a-f0-9]{64}$/.test(row.revision)),
          )
        )
          throw iamAccountDenied();
        await validate();
        const snapshot = await this.snapshots.snapshot(principal, Permission.SYSTEM_CONFIG),
          authorizationRevision = await this.repository.authorizationRevision(principal);
        let createdId: string | undefined;
        const guard: ContentSafetySystemRuleMutationGuard = {
          targets,
          group: snapshot.group,
          authorizationRevision,
          users: {
            principal,
            targetUserId: principal.subjectUserId,
            users: snapshot.users,
            recheck: async () => {
              await reader.recheck();
              await this.snapshots.recheck(principal, Permission.SYSTEM_CONFIG, snapshot);
              if ((await this.repository.authorizationRevision(principal)) !== authorizationRevision)
                throw iamAccountDenied();
            },
          },
          authorizeCreated: async (id) => {
            if (
              operation !== "CreateSystemRule" ||
              !isContentSafetyRuleId(id) ||
              (createdId !== undefined && createdId !== id)
            )
              throw iamAccountDenied();
            createdId = id;
            if (!(await reader.allowed([contentSafetySystemRuleArn(id)])).has(contentSafetySystemRuleArn(id)))
              throw iamAccountDenied();
            await guard.users.recheck();
          },
        };
        return guard;
      },
    );
  }
  private async mode<T>(
    operation: RuleOperation,
    ids: readonly string[],
    request: TypedRequest,
    validate: () => Promise<void>,
    native: (guard: ContentSafetySystemRuleMutationGuard) => Promise<T>,
    legacy: () => Promise<T>,
    created?: (result: T) => string,
  ) {
    const principal = request && getIamPrincipal(request),
      mode = env.security.iamAuthorizationMode;
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== principal.principalUserId ||
      !["legacy", "shadow", "enforce"].includes(mode)
    )
      throw iamAccountDenied();
    if (request.user?.impersonatorId && request.user.impersonationMode === "view")
      throw new ForbiddenError(
        "Read-only impersonation cannot mutate system rules",
        CustomCode.IMPERSONATION_READONLY_VIOLATION,
        { messageKey: "errors.impersonationReadonlyViolation" },
      );
    if (mode === "enforce") return native(await this.prepare(operation, ids, request, validate));
    if (
      !(
        await this.permissions.checkUserPermissions(principal.subjectUserId, [Permission.SYSTEM_CONFIG], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    let prepared: ContentSafetySystemRuleMutationGuard | undefined;
    if (mode === "shadow") {
      try {
        prepared = await this.prepare(operation, ids, request, validate);
      } catch {
        this.shadowDenied(operation);
      }
    }
    const result = await legacy();
    if (prepared && created) {
      try {
        const id = created(result),
          rows = await this.repository.targets([id]);
        if (rows.length !== 1 || rows[0]!.id !== id) throw iamAccountDenied();
        await prepared.authorizeCreated(id);
      } catch {
        this.shadowDenied(operation);
      }
    }
    return result;
  }
  private shadowDenied(operation: RuleOperation) {
    getLogger("ContentSafetyIamBridge", LogCategory.SECURITY).warn("IAM rule mutation shadow denied", {
      action: "quyan:content_safety:" + operation,
      reason: "iam-mutation-unavailable",
    });
  }
  async create(
    input: unknown,
    request: TypedRequest,
    validate: (data: ContentSafetySystemRuleData) => Promise<void>,
    legacy: () => Promise<ContentSafetyRule>,
  ) {
    const data = this.rule(input);
    return this.mode(
      "CreateSystemRule",
      [],
      request,
      () => validate(data),
      (guard) => this.repository.create(guard, data),
      legacy,
      (row) => row.id,
    );
  }
  async update(
    id: string,
    input: unknown,
    request: TypedRequest,
    validate: (data: ContentSafetySystemRuleData) => Promise<void>,
    legacy: () => Promise<ContentSafetyRule>,
  ) {
    const data = this.rule(input);
    return this.mode(
      "UpdateSystemRule",
      [id],
      request,
      () => validate(data),
      (guard) => this.repository.update(guard, data),
      legacy,
    );
  }
  async remove(id: string, request: TypedRequest, legacy: () => Promise<void>) {
    return this.mode(
      "DeleteSystemRule",
      [id],
      request,
      async () => {},
      (guard) => this.repository.remove(guard),
      legacy,
    );
  }
  async batch(input: unknown, request: TypedRequest, legacy: () => Promise<{ updated: number }>) {
    const parsed = contentSafetyBatchUpdateSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestError("Invalid rule batch", undefined, { messageKey: "errors.badRequest" });
    const data = parsed.data;
    return this.mode(
      "BatchUpdateSystemRules",
      data.ids,
      request,
      async () => {},
      (guard) => this.repository.batch(guard, data.changes),
      legacy,
    );
  }
}

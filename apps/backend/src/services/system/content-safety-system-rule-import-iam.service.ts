import { Permission, CustomCode } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import {
  contentSafetySystemRuleArn,
  contentSafetySystemRuleControlArn,
  isContentSafetyRuleId,
} from "@/iam/resources/content-safety-system-resources";
import { PlatformResourceReadIamService } from "./platform-resource-read-iam.service";
import { PlatformMetadataCollectionIamService } from "./platform-metadata-collection-iam.service";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { ContentSafetySystemReadRepository } from "@/store/system/content-safety-system-read.repository";
import { ContentSafetySystemRuleMutationRepository } from "@/store/system/content-safety-system-rule-mutation.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import type { ContentSafetySystemReadStore } from "@/store/system/content-safety-system-read.store";
import type {
  ContentSafetySystemRuleImportStore,
  ContentSafetySystemRuleImportGuard,
  ContentSafetySystemRuleImportOperation,
} from "@/store/system/content-safety-system-rule-mutation.store";
import type { ContentSafetyRule } from "@prisma/client";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { ForbiddenError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
export type ContentSafetySystemRuleImportPlan<T> = {
  operations: ContentSafetySystemRuleImportOperation[];
  result: T;
  apply: boolean;
};
export class ContentSafetySystemRuleImportIamService {
  private static instance: ContentSafetySystemRuleImportIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: ContentSafetySystemRuleImportStore = ContentSafetySystemRuleMutationRepository.getInstance(),
    private readonly reads: ContentSafetySystemReadStore = ContentSafetySystemReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new ContentSafetySystemRuleImportIamService());
  }
  private async prepare<T>(
    operation: "ImportSystemRules" | "ImportDefaultSystemRules",
    request: TypedRequest,
    plan: (existing: ContentSafetyRule[]) => Promise<ContentSafetySystemRuleImportPlan<T>>,
    defaultPatterns?: readonly string[],
  ) {
    const identity = getIamPrincipal(request);
    if (!identity) throw iamAccountDenied();
    const principal = { ...identity },
      action = "quyan:content_safety:" + operation;
    return new PlatformResourceReadIamService(this.iam, this.snapshots).read(
      action,
      principal,
      request,
      contentSafetySystemRuleControlArn(),
      async (reader) => {
        const sourceRevision = await this.repository.collectionRevision(),
          existing: ContentSafetyRule[] = [];
        if (defaultPatterns) {
          const targets = await this.repository.defaultTargets(defaultPatterns),
            resources = targets.map((row) => contentSafetySystemRuleArn(row.id));
          if ((await reader.allowed(resources)).size !== new Set(resources).size) throw iamAccountDenied();
          existing.push(...(await this.reads.hydrate(targets)));
        } else {
          await new PlatformMetadataCollectionIamService(
            this.iam,
            this.snapshots,
            this.reads,
            (row) => contentSafetySystemRuleArn(row.id),
            (row) => [row.revision, row.priority],
            (row) => PlatformMetadataCollectionIamService.valid(row) && /^[a-f0-9]{64}$/.test(row.revision),
          ).read(action, principal, request, undefined, {
            visit: async (targets) => {
              existing.push(...(await this.reads.hydrate(targets)));
            },
            finish: async () => undefined,
          });
        }
        const prepared = await plan(existing),
          ids = prepared.operations.filter((item) => item.operation === "update").map((item) => item.id);
        if (ids.some((id) => !isContentSafetyRuleId(id)) || new Set(ids).size !== ids.length) throw iamAccountDenied();
        const targets = await this.repository.targets(ids as string[]);
        if (targets.length !== ids.length || ids.some((id) => !targets.some((row) => row.id === id)))
          throw iamAccountDenied();
        const resources = targets.map((row) => contentSafetySystemRuleArn(row.id));
        if (
          (await reader.allowed(resources)).size !== resources.length ||
          (await this.repository.collectionRevision()) !== sourceRevision
        )
          throw iamAccountDenied();
        const snapshot = await this.snapshots.snapshot(principal, Permission.SYSTEM_CONFIG),
          authorizationRevision = await this.repository.authorizationRevision(principal);
        const created = new Set<string>();
        const guard: ContentSafetySystemRuleImportGuard = {
          targets,
          sourceRevision,
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
            if (!isContentSafetyRuleId(id) || created.has(id)) throw iamAccountDenied();
            created.add(id);
            const arn = contentSafetySystemRuleArn(id);
            if (!(await reader.allowed([arn])).has(arn)) throw iamAccountDenied();
            await guard.users.recheck();
          },
        };
        return { prepared, guard };
      },
    );
  }
  async execute<T>(
    operation: "ImportSystemRules" | "ImportDefaultSystemRules",
    request: TypedRequest,
    plan: (existing: ContentSafetyRule[]) => Promise<ContentSafetySystemRuleImportPlan<T>>,
    legacy: (onCreated?: (id: string) => Promise<void>) => Promise<T>,
    defaultPatterns?: readonly string[],
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
        "Read-only impersonation cannot import system rules",
        CustomCode.IMPERSONATION_READONLY_VIOLATION,
        { messageKey: "errors.impersonationReadonlyViolation" },
      );
    if (mode === "enforce") {
      const { prepared, guard } = await this.prepare(operation, request, plan, defaultPatterns);
      if (prepared.apply && prepared.operations.length) await this.repository.applyImport(guard, prepared.operations);
      else {
        await guard.users.recheck();
        if ((await this.repository.collectionRevision()) !== guard.sourceRevision) throw iamAccountDenied();
      }
      return prepared.result;
    }
    if (
      !(
        await this.permissions.checkUserPermissions(principal.subjectUserId, [Permission.SYSTEM_CONFIG], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    let shadowGuard: ContentSafetySystemRuleImportGuard | undefined;
    const shadowDenied = () =>
      getLogger("ContentSafetyIamBridge", LogCategory.SECURITY).warn("IAM rule import shadow denied", {
        action: "quyan:content_safety:" + operation,
        reason: "iam-import-unavailable",
      });
    if (mode === "shadow") {
      try {
        shadowGuard = (await this.prepare(operation, request, plan, defaultPatterns)).guard;
      } catch {
        shadowDenied();
      }
    }
    return legacy(
      shadowGuard
        ? async (id) => {
            try {
              await shadowGuard!.authorizeCreated(id);
            } catch {
              shadowDenied();
            }
          }
        : undefined,
    );
  }
}

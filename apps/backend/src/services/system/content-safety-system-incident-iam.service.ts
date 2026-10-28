import { performance } from "node:perf_hooks";
import { CONTENT_SAFETY_READ_LIMITS as limits } from "@/constant/content-safety-read";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import {
  contentSafetySystemIncidentArn,
  contentSafetySystemRuleArn,
} from "@/iam/resources/content-safety-system-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { ContentSafetySystemIncidentRepository } from "@/store/system/content-safety-system-incident.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import type {
  ContentSafetySystemIncidentStore,
  ContentSafetySystemIncidentTarget,
  ContentSafetySystemIncidentView,
} from "@/store/system/content-safety-system-incident.store";
import { PlatformMetadataCollectionIamService } from "./platform-metadata-collection-iam.service";
import { Permission } from "@quyan/shared";
import { PermissionService } from "@/services/users/permission.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { ContentSafetyIncidentQuery } from "@/api/dto/system/content-safety.dto";
import type { TypedRequest } from "@/types/express";

const action = "quyan:content_safety:ListSystemIncidents";
export class ContentSafetySystemIncidentIamService {
  private static instance: ContentSafetySystemIncidentIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: ContentSafetySystemIncidentStore = ContentSafetySystemIncidentRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new ContentSafetySystemIncidentIamService());
  }
  private async native(query: ContentSafetyIncidentQuery, request: TypedRequest) {
    const principal = getIamPrincipal(request);
    if (!principal) throw iamAccountDenied();
    const page = query.page ?? 1,
      pageSize = query.pageSize ?? 50;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > limits.maxPage ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > limits.maxPageSize
    )
      throw new BadRequestError("Invalid incident pagination", undefined, { messageKey: "errors.badRequest" });
    const selected: ContentSafetySystemIncidentTarget[] = [],
      keep = page * pageSize;
    let patternTargets: readonly ContentSafetySystemIncidentTarget[] = [],
      patternGrants = new Set<string>();
    const ruleAllow = async (targets: readonly ContentSafetySystemIncidentTarget[]) => {
      const ids = [
        ...new Set(
          targets
            .filter((row) => row.ruleId && row.ruleOwnerUserId === null && row.ruleStatus === 1)
            .map((row) => row.ruleId!),
        ),
      ];
      if (!ids.length) return new Set<string>();
      const start = performance.now(),
        ruleAction = "quyan:content_safety:ListSystemRules",
        resources = ids.map(contentSafetySystemRuleArn),
        results = await this.iam.authorizeMany({
          principal,
          action: ruleAction,
          resources,
          context: requestConditionContext(request, principal),
        });
      if (!Array.isArray(results) || results.length !== ids.length || results.some((result) => !result))
        throw iamAccountDenied();
      results.forEach((result, index) => {
        (request.iamDecisions ??= []).push({ ...result, action: ruleAction, resource: resources[index]! });
        request.iamDecisions.splice(
          0,
          Math.max(0, request.iamDecisions.length - IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
        );
        auditIamDecision({
          requestId: request.res?.locals.requestId,
          principal,
          action: ruleAction,
          resource: resources[index]!,
          result,
          evaluationLatencyMs: performance.now() - start,
          authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
        });
      });
      return new Set(ids.filter((_, index) => results[index]!.decision === "Allow"));
    };
    const result = await new PlatformMetadataCollectionIamService(
      this.iam,
      this.snapshots,
      this.repository,
      (row) => contentSafetySystemIncidentArn(row.id),
      (row) => [row.revision, row.sortRank],
      (row) =>
        PlatformMetadataCollectionIamService.valid(row) &&
        /^[a-f0-9]{64}$/.test(row.revision) &&
        Number.isSafeInteger(row.sortRank) &&
        row.sortRank > 0,
    ).read(
      action,
      principal,
      request,
      { ...query },
      {
        visit: async (targets) => {
          selected.push(...targets);
          selected.sort((a, b) => a.sortRank - b.sortRank);
          selected.splice(keep);
        },
        finish: async (total) => {
          const targets = selected.slice((page - 1) * pageSize, page * pageSize),
            allowed = await ruleAllow(targets),
            where = await this.repository.where(query);
          if (!where) throw iamAccountDenied();
          patternTargets = targets;
          patternGrants = allowed;
          const incidents = await this.repository.hydrate(where, targets, allowed);
          const rechecked = await ruleAllow(targets);
          if (allowed.size !== rechecked.size || [...allowed].some((id) => !rechecked.has(id)))
            throw iamAccountDenied();
          return { incidents, total };
        },
      },
    );
    if (!result) throw iamAccountDenied();
    const finalPatterns = await ruleAllow(patternTargets);
    if (patternGrants.size !== finalPatterns.size || [...patternGrants].some((id) => !finalPatterns.has(id)))
      throw iamAccountDenied();
    return result;
  }
  async list(
    query: ContentSafetyIncidentQuery,
    request: TypedRequest,
    legacy: () => Promise<{ incidents: ContentSafetySystemIncidentView[]; total: number }>,
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
    if (mode === "enforce") return this.native(query, request);
    if (
      !(
        await this.permissions.checkUserPermissions(principal.subjectUserId, [Permission.SYSTEM_CONFIG], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "shadow") {
      try {
        await this.native(query, request);
      } catch {
        getLogger("ContentSafetyIamBridge", LogCategory.SECURITY).warn("IAM incident read shadow denied", {
          action,
          reason: "iam-read-unavailable",
        });
      }
    }
    return legacy();
  }
}

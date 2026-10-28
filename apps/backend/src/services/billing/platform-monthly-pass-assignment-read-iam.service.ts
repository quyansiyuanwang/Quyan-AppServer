import { createHash } from "node:crypto";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { platformMonthlyPassArn, platformMonthlyPassUsageArn } from "@/iam/resources/platform-monthly-pass-resources";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { PlatformMetadataCollectionIamService } from "../system/platform-metadata-collection-iam.service";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import {
  PlatformMonthlyPassAssignmentReadRepository,
  validMonthlyPassAssignmentReadTarget,
} from "@/store/billing/platform-monthly-pass-assignment-read.repository";
import type {
  MonthlyPassAssignmentFilters,
  MonthlyPassAssignmentReadTarget,
  MonthlyPassAssignmentProjection,
  MonthlyPassAssignmentReadView,
  PlatformMonthlyPassAssignmentReadStore,
} from "@/store/billing/platform-monthly-pass-assignment-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "../users/permission.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const action = "quyan:monthly_pass:ListUserPasses",
  limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
export class PlatformMonthlyPassAssignmentReadIamService {
  private static instance: PlatformMonthlyPassAssignmentReadIamService;
  static getInstance() {
    return (this.instance ??= new PlatformMonthlyPassAssignmentReadIamService());
  }
  constructor(
    private readonly repository: PlatformMonthlyPassAssignmentReadStore = PlatformMonthlyPassAssignmentReadRepository.getInstance(),
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  private async project(principal: IamPrincipal, request: TypedRequest, target: MonthlyPassAssignmentReadTarget) {
    const resources = [platformUserArn(target.userId), platformTemplateArn("monthly-pass", target.templateId)],
      decisions = await platformCollectionDecisions(this.iam, { action, principal, request, resources });
    const projection: MonthlyPassAssignmentProjection = {
        username: decisions[0] === "Allow",
        template: decisions[1] === "Allow",
        quotaUsage: true,
      },
      hash = createHash("sha256");
    hash.update(JSON.stringify(resources.map((resource, index) => [resource, decisions[index]])));
    let after: string | undefined;
    for (;;) {
      const rows = await this.repository.scanUsages(target, after);
      if (
        !Array.isArray(rows) ||
        rows.length > limit ||
        rows.some(
          (row, index) =>
            !row ||
            !isPlatformLogResourceId(row.id) ||
            row.userId !== target.userId ||
            row.userMonthlyPassId !== target.id ||
            row.status !== 1 ||
            (after !== undefined && row.id <= after) ||
            (index > 0 && row.id <= rows[index - 1]!.id),
        )
      )
        throw iamAccountDenied();
      if (!rows.length) break;
      const outcomes = await platformCollectionDecisions(this.iam, {
        action,
        principal,
        request,
        resources: rows.map((row) => platformMonthlyPassUsageArn(row.userId, row.userMonthlyPassId, row.id)),
      });
      rows.forEach((row, index) => {
        projection.quotaUsage &&= outcomes[index] === "Allow";
        hash.update(JSON.stringify([row.id, row.userId, row.userMonthlyPassId, outcomes[index]]) + "\n");
      });
      after = rows[rows.length - 1]!.id;
      if (rows.length < limit) break;
    }
    return { projection, signature: hash.digest("hex") };
  }
  async list<T>(
    request: TypedRequest,
    pagination: { page: number; pageSize: number },
    filters: MonthlyPassAssignmentFilters,
    map: (view: MonthlyPassAssignmentReadView) => Promise<T> | T,
    legacy: () => Promise<{ total: number; records: T[] }>,
  ) {
    const principal = request && getIamPrincipal(request),
      mode = env.security.iamAuthorizationMode;
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== principal.principalUserId ||
      !["legacy", "shadow", "enforce"].includes(mode) ||
      !Number.isSafeInteger(pagination.page) ||
      pagination.page < 1 ||
      !Number.isSafeInteger(pagination.pageSize) ||
      pagination.pageSize < 1 ||
      pagination.pageSize > 100 ||
      !Number.isSafeInteger(pagination.page * pagination.pageSize)
    )
      throw iamAccountDenied();
    const native = async () => {
      const selected: MonthlyPassAssignmentReadTarget[] = [],
        projections = new Map<string, MonthlyPassAssignmentProjection>();
      const result = await new PlatformMetadataCollectionIamService(
        this.iam,
        this.snapshots,
        this.repository,
        (target) => platformMonthlyPassArn(target.userId, target.id),
        async (target) => {
          const { projection, signature } = await this.project(principal, request, target);
          projections.set(target.id, projection);
          return [target.revision, target.displayOrder, projection, signature];
        },
        validMonthlyPassAssignmentReadTarget,
      ).read(action, principal, request, filters, {
        visit: async (targets) => {
          selected.push(...targets);
        },
        finish: async (total) => {
          selected.sort((a, b) => a.displayOrder - b.displayOrder);
          const page = selected.slice(
            (pagination.page - 1) * pagination.pageSize,
            pagination.page * pagination.pageSize,
          );
          const views = await this.repository.hydrate(
            principal,
            page.map((target) => {
              const projection = projections.get(target.id);
              if (!projection) throw iamAccountDenied();
              return { target, projection };
            }),
          );
          if (
            !Array.isArray(views) ||
            views.length !== page.length ||
            views.some(
              (view, index) =>
                !view ||
                view.record.id !== page[index]?.id ||
                view.record.userId !== page[index]?.userId ||
                view.record.templateId !== page[index]?.templateId ||
                view.quotaUsage !== projections.get(view.record.id)?.quotaUsage ||
                (!projections.get(view.record.id)?.username && view.record.user.username !== "") ||
                (!projections.get(view.record.id)?.template &&
                  (view.record.template.name !== "" ||
                    view.record.template.description !== null ||
                    view.record.template.allowedModels !== null ||
                    view.record.template.allowedChannels !== null)),
            )
          )
            throw iamAccountDenied();
          return { total, records: await Promise.all(views.map(map)), ...pagination };
        },
      });
      if (!result) throw iamAccountDenied();
      return result;
    };
    if (mode === "enforce") return native();
    if (
      !(
        await this.permissions.checkUserPermissions(
          principal.subjectUserId,
          [Permission.MONTHLY_PASS_ASSIGNMENT_READ],
          { assumedRoleSessionId: principal.roleSessionId },
        )
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "shadow")
      try {
        await native();
      } catch {
        getLogger("MonthlyPassAssignmentReadIam", LogCategory.SECURITY).warn(
          "Assignment read shadow evaluation failed",
          { action, reason: "iam-evaluation-denied-or-unavailable" },
        );
      }
    return { ...(await legacy()), ...pagination };
  }
}

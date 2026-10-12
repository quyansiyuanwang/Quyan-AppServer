import { upsertQuotaOverrideBodySchema } from "@/api/schema/developer/developer.schema";
import type { DeveloperQuotaOverride } from "@prisma/client";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { DeveloperProjectRepository } from "@/store/developer/developer-project.repository";
import { PermissionService } from "@/services/users/permission.service";
import { PlatformDeveloperQuotaReadIamService } from "./platform-developer-quota-read-iam.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { DeveloperQuotaOverrideDto, UpsertDeveloperQuotaOverrideDto } from "@/api/dto/developer/developer.dto";
export class DeveloperQuotaAdminService {
  private static instance: DeveloperQuotaAdminService;
  private constructor(
    private readonly repository = DeveloperProjectRepository.getInstance(),
    private readonly iamReads = PlatformDeveloperQuotaReadIamService.getInstance(),
    private readonly permissions = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new DeveloperQuotaAdminService());
  }
  private dto(row: DeveloperQuotaOverride): DeveloperQuotaOverrideDto {
    if (row.expiresAt && !Number.isFinite(row.expiresAt.getTime())) throw iamAccountDenied();
    const parsed = upsertQuotaOverrideBodySchema
      .strict()
      .safeParse({
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        service: row.service === "*" ? undefined : row.service,
        dailyFreeQuota: row.dailyFreeQuota,
        expiresAt: row.expiresAt?.toISOString(),
      });
    if (!parsed.success) throw iamAccountDenied();
    return {
      id: row.id,
      ...parsed.data,
      expiresAt: parsed.data.expiresAt ?? undefined,
      createTime: row.createTime.toISOString(),
      updateTime: row.updateTime.toISOString(),
    };
  }
  async list(request: TypedRequest) {
    const project = (rows: DeveloperQuotaOverride[]) => rows.map((row) => this.dto(row));
    if (env.security.iamAuthorizationMode === "enforce") {
      const result = await this.iamReads.list(request, project);
      if (!result) throw iamAccountDenied();
      return result;
    }
    const principal = request && getIamPrincipal(request);
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== principal.principalUserId ||
      !["legacy", "shadow"].includes(env.security.iamAuthorizationMode) ||
      !(
        await this.permissions.checkUserPermissions(principal.subjectUserId, [Permission.DEVELOPER_QUOTA_MANAGE], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (env.security.iamAuthorizationMode === "shadow") {
      try {
        await this.iamReads.list(request, project, false);
      } catch {
        getLogger("DeveloperQuota", LogCategory.SECURITY).warn("Developer quota list shadow evaluation failed", {
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    }
    return this.repository.listQuotaOverrides();
  }
  async upsert(body: UpsertDeveloperQuotaOverrideDto, actorUserId: string) {
    return this.repository.upsertQuotaOverride(body, actorUserId);
  }
  async remove(id: string) {
    return this.repository.deleteQuotaOverride(id);
  }
}

import { CONTENT_SAFETY_READ_LIMITS as readLimits } from "@/constant/content-safety-read";
import type { ContentSafetyRule } from "@prisma/client";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import {
  contentSafetySystemConfigArn,
  contentSafetySystemRuleArn,
} from "@/iam/resources/content-safety-system-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { PlatformResourceReadIamService } from "./platform-resource-read-iam.service";
import { PlatformMetadataCollectionIamService } from "./platform-metadata-collection-iam.service";
import { ContentSafetySystemReadRepository } from "@/store/system/content-safety-system-read.repository";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import type {
  ContentSafetySystemReadStore,
  ContentSafetySystemRuleTarget,
} from "@/store/system/content-safety-system-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import { renderContentSafetyPolicyExport } from "./content-safety-policy-export";

export class ContentSafetySystemReadIamService {
  private static instance: ContentSafetySystemReadIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: ContentSafetySystemReadStore = ContentSafetySystemReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new ContentSafetySystemReadIamService());
  }
  private async mode<T>(
    action: string,
    request: TypedRequest,
    legacy: () => Promise<T>,
    native: (identity: NonNullable<ReturnType<typeof getIamPrincipal>>) => Promise<T>,
  ) {
    const identity = getIamPrincipal(request),
      mode = env.security.iamAuthorizationMode;
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !["legacy", "shadow", "enforce"].includes(mode)
    )
      throw iamAccountDenied();
    if (mode === "enforce") return native({ ...identity });
    if (
      !(
        await this.permissions.checkUserPermissions(identity.subjectUserId, [Permission.SYSTEM_CONFIG], {
          assumedRoleSessionId: identity.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "shadow") {
      try {
        await native({ ...identity });
      } catch {
        getLogger("ContentSafetyIamBridge", LogCategory.SECURITY).warn("IAM content safety read shadow denied", {
          action,
          reason: "iam-read-unavailable",
        });
      }
    }
    return legacy();
  }
  private async nativeConfig<T>(
    principal: NonNullable<ReturnType<typeof getIamPrincipal>>,
    request: TypedRequest,
    view: (values: Record<string, string>) => Promise<T>,
  ) {
    return new PlatformResourceReadIamService(this.iam, this.snapshots).read(
      "quyan:content_safety:GetSystemConfig",
      principal,
      request,
      contentSafetySystemConfigArn(),
      async (guard) => {
        const source = await this.repository.configuration();
        const recheck = async () => {
          if ((await this.repository.configuration()).revision !== source.revision) throw iamAccountDenied();
        };
        guard.trackSource(recheck);
        const result = await view(source.values);
        await recheck();
        return result;
      },
    );
  }
  config<T>(request: TypedRequest, legacy: () => Promise<T>, view: (values: Record<string, string>) => Promise<T>) {
    return this.mode("quyan:content_safety:GetSystemConfig", request, legacy, (principal) =>
      this.nativeConfig(principal, request, view),
    );
  }
  private reader() {
    return new PlatformMetadataCollectionIamService(
      this.iam,
      this.snapshots,
      this.repository,
      (row) => contentSafetySystemRuleArn(row.id),
      (row) => [row.priority, row.revision],
      (row) =>
        PlatformMetadataCollectionIamService.valid(row) &&
        Number.isSafeInteger(row.priority) &&
        /^[a-f0-9]{64}$/.test(row.revision),
    );
  }
  async list(
    request: TypedRequest,
    page: number,
    pageSize: number,
    legacy: () => Promise<{ rules: ContentSafetyRule[]; total: number }>,
  ) {
    return this.mode("quyan:content_safety:ListSystemRules", request, legacy, async (principal) => {
      if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        page > readLimits.maxPage ||
        !Number.isSafeInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > readLimits.maxPageSize
      )
        throw new BadRequestError("Invalid content safety pagination", undefined, { messageKey: "errors.badRequest" });
      const selected: ContentSafetySystemRuleTarget[] = [],
        offset = (page - 1) * pageSize;
      const result = await this.reader().read("quyan:content_safety:ListSystemRules", principal, request, undefined, {
        visit: async (rows) => {
          selected.push(...rows);
          selected.sort(
            (a, b) =>
              a.priority - b.priority || b.createTime.getTime() - a.createTime.getTime() || b.id.localeCompare(a.id),
          );
          selected.splice(offset + pageSize);
        },
        finish: async (total) => ({
          rules: await this.repository.hydrate(selected.slice(offset, offset + pageSize)),
          total,
        }),
      });
      if (!result) throw iamAccountDenied();
      return result;
    });
  }
  async export(
    request: TypedRequest,
    format: "json" | "csv",
    legacy: () => Promise<ReturnType<typeof renderContentSafetyPolicyExport>>,
    view: (values: Record<string, string>) => Promise<unknown>,
  ) {
    if (!["json", "csv"].includes(format))
      throw new BadRequestError("Invalid export format", undefined, { messageKey: "errors.badRequest" });
    return this.mode("quyan:content_safety:ExportSystemRules", request, legacy, async (principal) => {
      const readRules = async (config: unknown) => {
        const selected: ContentSafetySystemRuleTarget[] = [];
        const result = await this.reader().read(
          "quyan:content_safety:ExportSystemRules",
          principal,
          request,
          undefined,
          {
            visit: async (rows) => {
              selected.push(...rows);
            },
            finish: async () => {
              selected.sort(
                (a, b) =>
                  a.priority - b.priority ||
                  a.createTime.getTime() - b.createTime.getTime() ||
                  a.id.localeCompare(b.id),
              );
              const rules = [];
              for (let offset = 0; offset < selected.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
                const rows = await this.repository.hydrate(
                  selected.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
                );
                rules.push(
                  ...rows.map((row) => ({
                    id: row.id,
                    name: row.name,
                    type: row.type,
                    pattern: row.pattern,
                    direction: row.direction,
                    action: row.action,
                    enabled: row.enabled,
                    priority: row.priority,
                    source: row.source,
                  })),
                );
              }
              return renderContentSafetyPolicyExport(config, rules, format, "system");
            },
          },
        );
        if (!result) throw iamAccountDenied();
        return result;
      };
      // Keep the config guard around the entire JSON read, including the final rule snapshot scan.
      return format === "json"
        ? this.nativeConfig(principal, request, async (values) => readRules(await view(values)))
        : readRules({});
    });
  }
}

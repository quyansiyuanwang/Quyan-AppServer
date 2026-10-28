import { platformIpAddressArn, platformIpAddressIdentifier } from "@/iam/resources/platform-ip-address-resources";
import { PlatformMetadataCollectionIamService } from "./platform-metadata-collection-iam.service";
import { iamLegacyPermissionsForAction } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformIPBlacklistCollectionRepository } from "@/store/security/platform-ip-blacklist-collection.repository";
import type { PlatformIPBlacklistCollectionStore } from "@/store/security/platform-ip-blacklist-collection.repository";
import type { PlatformIPBlacklistTarget } from "@/store/security/platform-ip-blacklist-collection.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { IPBlackListService } from "./ipblacklist.service";
import { ipBlacklistListQuerySchema } from "@/api/schema/system/ipblacklist.schema";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { IPBlackList } from "@/store/security/ipblacklist.store";
const action = "quyan:system:ip_blacklist:ListBlacklists";
export class PlatformIPBlacklistListIamService {
  private static instance: PlatformIPBlacklistListIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformIPBlacklistCollectionStore = PlatformIPBlacklistCollectionRepository.getInstance(),
    private readonly reports: Pick<IPBlackListService, "getBlacklist"> = IPBlackListService.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformIPBlacklistListIamService());
  }
  async list(
    limit: number,
    offset: number,
    request: TypedRequest,
  ): Promise<{ blacklists: IPBlackList[]; total: number }> {
    const query = ipBlacklistListQuerySchema.safeParse({ limit, offset });
    if (!query.success)
      throw new BadRequestError("Invalid blacklist query", undefined, { messageKey: "errors.badRequest" });
    const identity = getIamPrincipal(request),
      required = iamLegacyPermissionsForAction(action);
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !required.length ||
      !["legacy", "shadow", "enforce"].includes(env.security.iamAuthorizationMode)
    )
      throw iamAccountDenied();
    const principal = { ...identity };
    const native = async (hydrate: boolean) => {
      const pageTargets: PlatformIPBlacklistTarget[] = [];
      let totalSeen = 0;
      return new PlatformMetadataCollectionIamService(this.iam, this.snapshots, this.repository, (target) => {
        if (!platformIpAddressIdentifier(target.ipAddress)) throw iamAccountDenied();
        return platformIpAddressArn(target.ipAddress);
      }).read(
        action,
        principal,
        request,
        {},
        hydrate
          ? {
              visit: async (targets) => {
                for (const target of targets) {
                  if (totalSeen >= offset && pageTargets.length < limit) pageTargets.push(target);
                  totalSeen++;
                }
              },
              finish: async (total) => {
                const rows = pageTargets.length ? await this.repository.hydrate(pageTargets) : [];
                if (
                  rows.length !== pageTargets.length ||
                  new Set(rows.map((row) => row.id)).size !== rows.length ||
                  rows.some(
                    (row) =>
                      !PlatformMetadataCollectionIamService.valid(row) ||
                      !pageTargets.some(
                        (target) =>
                          target.id === row.id &&
                          target.ipAddress === row.ipAddress &&
                          target.createTime.getTime() === row.createTime.getTime() &&
                          target.updateTime.getTime() === row.updateTime.getTime(),
                      ),
                  )
                )
                  throw iamAccountDenied();
                const byId = new Map(rows.map((row) => [row.id, row]));
                return { blacklists: pageTargets.map((target) => byId.get(target.id)!), total };
              },
            }
          : undefined,
      );
    };
    if (env.security.iamAuthorizationMode !== "enforce") {
      const result = await this.permissions.checkUserPermissions(principal.subjectUserId, required, {
        assumedRoleSessionId: principal.roleSessionId,
      });
      if (
        !result.checkedPermissions.some(
          (permission) => required.includes(permission) && !result.missingPermissions?.includes(permission),
        )
      )
        throw iamAccountDenied();
      if (env.security.iamAuthorizationMode === "shadow") {
        try {
          await native(false);
        } catch {
          getLogger("IPBlacklistListIam", LogCategory.SECURITY).warn("IP blacklist IAM shadow evaluation failed", {
            action,
            reason: "iam-evaluation-denied-or-unavailable",
          });
        }
      }
      return this.reports.getBlacklist({ limit, offset });
    }
    const result = await native(true);
    if (!result) throw iamAccountDenied();
    return result;
  }
}

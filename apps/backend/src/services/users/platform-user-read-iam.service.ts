import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformUserArn, isPlatformUserId } from "@/iam/resources/platform-user-resources";
import { PlatformMetadataCollectionIamService } from "@/services/system/platform-metadata-collection-iam.service";
import { PlatformResourceReadIamService } from "@/services/system/platform-resource-read-iam.service";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformUserReadRepository, validPlatformUserTarget } from "@/store/users/platform-user-read.repository";
import type {
  PlatformUserReadStore,
  PlatformUserReadTarget,
  PlatformUserReadView,
} from "@/store/users/platform-user-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { userListQuerySchema } from "@/api/schema/users/user.schema";
import { BadRequestError } from "@/util/errors";
import { UserService } from "./user.service";
import { PermissionService } from "./permission.service";
import { userViewDto } from "./user-view";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
export type PlatformUserReadQuery = Partial<Omit<Parameters<UserService["getVisibleUsersPage"]>[0], "actorUserId">>;
export class PlatformUserReadIamService {
  private static instance: PlatformUserReadIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformUserReadStore = PlatformUserReadRepository.getInstance(),
    private readonly legacy: Pick<UserService, "getVisibleUsersPage" | "getUserById"> = UserService.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformUserReadIamService());
  }
  private identity(request: TypedRequest) {
    const principal = getIamPrincipal(request),
      mode = env.security.iamAuthorizationMode;
    if (
      !principal ||
      principal.subjectUserId !== principal.principalUserId ||
      request.oauthAccessToken ||
      !["legacy", "shadow", "enforce"].includes(mode)
    )
      throw iamAccountDenied();
    return { ...principal };
  }
  private async legacyAllowed(request: TypedRequest) {
    if (
      !(
        await this.permissions.checkUserPermissions(request.user!.userId, [Permission.USER_READ], {
          assumedRoleSessionId: request.authContext?.roleSessionId ?? request.user!.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
  }
  private view(row: PlatformUserReadView) {
    if (!Number.isFinite(Number(row.balanceAccount?.balance ?? 0))) throw iamAccountDenied();
    return userViewDto(row, row.balanceAccount, row.group);
  }
  async list(input: PlatformUserReadQuery, request: TypedRequest) {
    const principal = this.identity(request),
      parsed = userListQuerySchema.strict().safeParse(input);
    if (!parsed.success)
      throw new BadRequestError("Invalid platform user query", undefined, { messageKey: "errors.badRequest" });
    const query = parsed.data,
      page = query.page ?? 1,
      pageSize = query.pageSize ?? 20;
    const native = async (hydrate: boolean) => {
      const selected: PlatformUserReadTarget[] = [];
      let admitted = 0;
      const result = await new PlatformMetadataCollectionIamService(
        this.iam,
        this.snapshots,
        {
          where: () =>
            this.repository.where(principal, {
              keyword: query.keyword,
              userId: query.userId,
              groupId: query.groupId,
              excludeUserId: query.excludeCurrentUser ? principal.subjectUserId : undefined,
              userType: query.userType,
              hasRamPermission: query.hasRamPermission,
              ...(!query.userType && !query.hasRamPermission ? { excludeUserType: "ram_user" } : {}),
            }),
          scan: (where, after, boundary) => this.repository.scan(principal, where, after, boundary),
        },
        (target: PlatformUserReadTarget) => platformUserArn(target.id),
        (target) => [target.status, target.revision],
        validPlatformUserTarget,
      ).read("quyan:user:ListUsers", principal, request, input, {
        visit: async (targets) => {
          for (const target of targets) {
            if (admitted >= (page - 1) * pageSize && selected.length < pageSize) selected.push(target);
            admitted++;
          }
        },
        finish: async (total) => {
          if (!hydrate) return { users: [], total, page, pageSize, hasMore: page * pageSize < total };
          const rows = await this.repository.hydrate(principal, selected);
          if (
            !Array.isArray(rows) ||
            rows.length !== selected.length ||
            new Set(rows.map((row) => row.id)).size !== rows.length ||
            rows.some((row) => !selected.some((target) => target.id === row.id && target.status === row.status))
          )
            throw iamAccountDenied();
          const byId = new Map(rows.map((row) => [row.id, row]));
          return {
            users: selected.map((target) => this.view(byId.get(target.id)!)),
            total,
            page,
            pageSize,
            hasMore: page * pageSize < total,
          };
        },
      });
      if (!result) throw iamAccountDenied();
      return result;
    };
    if (env.security.iamAuthorizationMode === "enforce") return native(true);
    await this.legacyAllowed(request);
    if (env.security.iamAuthorizationMode === "shadow")
      try {
        await native(false);
      } catch {
        this.shadow("quyan:user:ListUsers");
      }
    return this.legacy.getVisibleUsersPage({ ...query, page, pageSize, actorUserId: principal.subjectUserId });
  }
  async detail(id: string, request: TypedRequest) {
    const principal = this.identity(request);
    if (!isPlatformUserId(id)) throw iamAccountDenied();
    const native = async (hydrate: boolean) => {
      const target = await this.repository.target(principal, id);
      if (!target || target.id !== id || !validPlatformUserTarget(target)) throw iamAccountDenied();
      return new PlatformResourceReadIamService(this.iam, this.snapshots).read(
        "quyan:user:GetUser",
        principal,
        request,
        platformUserArn(id),
        async (guard) => {
          guard.trackSource(() => this.repository.recheck(principal, [target]));
          if (!hydrate) return undefined;
          await guard.recheck();
          const rows = await this.repository.hydrate(principal, [target]);
          if (!Array.isArray(rows) || rows.length !== 1 || rows[0]!.id !== id || rows[0]!.status !== target.status)
            throw iamAccountDenied();
          return this.view(rows[0]!);
        },
      );
    };
    if (env.security.iamAuthorizationMode === "enforce") {
      const result = await native(true);
      if (!result) throw iamAccountDenied();
      return result;
    }
    await this.legacyAllowed(request);
    if (env.security.iamAuthorizationMode === "shadow")
      try {
        await native(false);
      } catch {
        this.shadow("quyan:user:GetUser");
      }
    return this.legacy.getUserById(id);
  }
  private shadow(action: string) {
    getLogger("PlatformUserReadIamService", LogCategory.SECURITY).warn(
      "IAM platform user read shadow evaluation failed",
      { action },
    );
  }
}

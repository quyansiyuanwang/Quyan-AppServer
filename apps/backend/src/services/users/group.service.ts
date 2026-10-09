import type { GroupDto, CreateGroupDto, UpdateGroupDto, GetAllGroupsData } from "@/api/dto/users/group.dto";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { BadRequestError, NotFoundError, ForbiddenError } from "@/util/errors";
import { GroupRepository } from "@/store/users/group.repository";
import { UserRepository } from "@/store/users/user.repository";
import type {
  GroupStore,
  GroupWithUserCount,
  GroupListFilters,
  GroupPermissionSnapshot,
} from "@/store/users/group.store";
import type { UserStore } from "@/store/users/user.store";
import type { Request } from "express";
import { env } from "@/config/env";
import { extractClientIp } from "@/util/ip-extractor";
import { iamManagementPaginationSchema } from "@/iam/management-pagination";
import { getRequestContext } from "@/util/request-context";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext, principalConditionContext } from "@/iam/request/condition-context";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { PermissionService } from "@/services/users/permission.service";
import { buildAcsResource, IAM_MANAGEMENT_PAGINATION, type IamPrincipal, type Permission } from "@quyan/shared";

export class GroupService {
  private static instance: GroupService;
  static getInstance(): GroupService {
    return (this.instance ??= new GroupService());
  }

  constructor(
    private readonly groupRepository: GroupStore = GroupRepository.getInstance(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
  ) {}

  private async iamManagementContext(actorUserId: string) {
    const actor = await this.userRepository.findByIdWithGroup(actorUserId);
    const request = getRequestContext();
    const owner = actor?.accountOwnerId || actor?.id;
    const principal: IamPrincipal | undefined = request
      ? getIamPrincipal(request)
      : actor && owner
        ? {
            subjectUserId: actor.id,
            principalUserId: actor.id,
            accountOwnerId: owner,
            subjectType: actor.userType === "root" && actor.id === owner ? "root" : "sub_user",
          }
        : undefined;
    if (
      !actor ||
      actor.status !== 1 ||
      !principal ||
      principal.principalUserId !== actor.id ||
      principal.subjectUserId !== actor.id ||
      principal.accountOwnerId !== owner ||
      (actor.group?.accountOwnerId && actor.group.accountOwnerId !== owner)
    )
      throw new ForbiddenError("Invalid group management identity", undefined, {
        messageKey: "permission.insufficientPermission",
      });
    const recovery =
      actor.userType === "root" &&
      actor.id === owner &&
      principal.subjectType === "root" &&
      actor.group?.status === 1 &&
      actor.group.accountOwnerId === null &&
      actor.group.username === env.security.superAdminGroupUsername
        ? actor.group.id
        : undefined;
    const filters: GroupListFilters = {
      accountOwnerId: owner,
      ...(recovery ? { recoveryGroupId: recovery } : {}),
      ...(actor.group?.status === 1 && actor.group.username !== env.security.superAdminGroupUsername
        ? { minLevel: actor.group.level }
        : {}),
    };
    return {
      principal,
      filters,
      context: request ? requestConditionContext(request, principal) : principalConditionContext(principal),
    };
  }

  private async assertIamTargetAccount(
    group: { id: string; accountOwnerId: string | null; status: number },
    actorUserId?: string,
  ): Promise<void> {
    if (env.security.iamAuthorizationMode !== "enforce") return;
    if (!actorUserId)
      throw new ForbiddenError("Group actor is missing", undefined, {
        messageKey: "permission.insufficientPermission",
      });
    const { filters } = await this.iamManagementContext(actorUserId);
    if (group.status !== 1 || (group.accountOwnerId !== filters.accountOwnerId && group.id !== filters.recoveryGroupId))
      throw new ForbiddenError("Group target crosses account scope", undefined, {
        messageKey: "permission.insufficientPermission",
      });
  }

  private async getIamVisibleGroupsPage(options: {
    actorUserId: string;
    page: number;
    pageSize: number;
    keyword?: string;
    hasRamPermission?: boolean;
  }): Promise<GetAllGroupsData> {
    const pagination = iamManagementPaginationSchema.safeParse(options);
    if (!pagination.success)
      throw new BadRequestError("Invalid IAM group page", undefined, {
        messageKey: "validation.fieldInvalidValue",
        messageParams: { field: "pagination" },
      });
    const { page, pageSize } = pagination.data;
    const { principal, filters, context } = await this.iamManagementContext(options.actorUserId);
    const policies = await IamAuthorizationService.getInstance().loadPolicies(principal);
    const candidates = await this.groupRepository.listActiveWithUserCountPaginated({
      ...filters,
      keyword: options.keyword,
      hasRamPermission: options.hasRamPermission,
      skip: (page - 1) * pageSize,
      take: pageSize + 1,
    });
    const groups = candidates
      .slice(0, pageSize)
      .filter(
        (group) =>
          evaluatePolicies(policies, {
            action: "quyan:group:Read",
            context,
            resource: buildAcsResource({
              service: "quyan",
              region: "*",
              accountId: principal.accountOwnerId,
              path: "group/" + group.id,
            }),
          }).decision === "Allow",
      )
      .map((group) => this.mapGroupToDto(group));
    return { groups, page, pageSize, hasMore: candidates.length > pageSize };
  }

  private getClientIP(req?: Request): string {
    if (!req) return "unknown";
    return extractClientIp(req);
  }

  private mapGroupToDto(group: GroupWithUserCount): GroupDto {
    const permissions = typeof group.permissions === "string" ? JSON.parse(group.permissions) : group.permissions;
    return {
      id: group.id,
      username: group.username,
      name: group.name,
      permissions: Array.isArray(permissions) ? permissions : [],
      level: group.level,
      description: group.description,
      userCount: group._count?.users,
      createdAt: group.createTime.toISOString(),
      updatedAt: group.updateTime.toISOString(),
    };
  }

  async getAllGroups(): Promise<GroupDto[]> {
    const groups = await this.groupRepository.listActiveWithUserCount();
    return groups.map((g) => this.mapGroupToDto(g));
  }

  /**
   * 获取当前用户可见的用户组列表（根据级别过滤）
   * 只能看到 level >= 自己 level 的组（权限更低或相同的组）
   * 管理员可以看到所有组
   */
  async getVisibleGroups(actorUserId: string): Promise<GroupDto[]> {
    if (env.security.iamAuthorizationMode === "enforce")
      return (
        await this.getIamVisibleGroupsPage({
          actorUserId,
          page: 1,
          pageSize: IAM_MANAGEMENT_PAGINATION.defaultPageSize,
        })
      ).groups;
    const actorUser = await this.userRepository.findById(actorUserId);
    if (!actorUser || !actorUser.groupId) return [];

    const actorGroup = await this.groupRepository.findById(actorUser.groupId);
    if (!actorGroup) return [];

    // 如果是超级管理员组，返回所有组
    if (actorGroup.username === env.security.superAdminGroupUsername) return this.getAllGroups();

    // 否则只返回 level >= actorGroup.level 的组
    const groups = await this.groupRepository.listVisibleWithUserCount(actorGroup.level);
    return groups.map((g) => this.mapGroupToDto(g));
  }

  /**
   * 分页获取当前用户可见的用户组列表
   */
  async getVisibleGroupsPage(options: {
    actorUserId: string;
    page: number;
    pageSize: number;
    keyword?: string;
    hasRamPermission?: boolean;
  }): Promise<GetAllGroupsData> {
    if (env.security.iamAuthorizationMode === "enforce") return this.getIamVisibleGroupsPage(options);
    const actorUser = await this.userRepository.findById(options.actorUserId);
    if (!actorUser || !actorUser.groupId)
      return { groups: [], total: 0, page: options.page, pageSize: options.pageSize, hasMore: false };

    const actorGroup = await this.groupRepository.findById(actorUser.groupId);
    if (!actorGroup) return { groups: [], total: 0, page: options.page, pageSize: options.pageSize, hasMore: false };

    const filters: GroupListFilters = {
      keyword: options.keyword,
      hasRamPermission: options.hasRamPermission,
    };

    // 非管理员只能看到 level >= 自己 level 的组
    if (actorGroup.username !== env.security.superAdminGroupUsername) filters.minLevel = actorGroup.level;

    const skip = (options.page - 1) * options.pageSize;
    const [total, groups] = await Promise.all([
      this.groupRepository.countActiveFiltered(filters),
      this.groupRepository.listActiveWithUserCountPaginated({ ...filters, skip, take: options.pageSize }),
    ]);

    return {
      groups: groups.map((g) => this.mapGroupToDto(g)),
      total,
      page: options.page,
      pageSize: options.pageSize,
      hasMore: skip + groups.length < total,
    };
  }

  async getGroupById(id: string, actorUserId?: string): Promise<GroupDto | null> {
    const scoped = env.security.iamAuthorizationMode === "enforce";
    const owner =
      scoped && actorUserId ? (await this.iamManagementContext(actorUserId)).principal.accountOwnerId : undefined;
    const group = await this.groupRepository.findByIdWithUserCount(id, owner);
    if (group) await this.assertIamTargetAccount(group, actorUserId);
    return group ? this.mapGroupToDto(group) : null;
  }

  async createGroup(data: CreateGroupDto, actorUserId: string, request?: Request): Promise<GroupDto> {
    const existing = await this.groupRepository.findByUsername(data.username);
    if (existing) throw new BadRequestError("组标识已存在", undefined, { messageKey: "group.identifierExists" });

    const iam =
      env.security.iamAuthorizationMode === "enforce" ? await this.iamManagementContext(actorUserId) : undefined;
    const group = await this.groupRepository.createWithUserCount({
      ...(iam ? { accountOwnerId: iam.principal.accountOwnerId } : {}),
      username: data.username,
      name: data.name || null,
      level: data.level,
      description: data.description || null,
      permissions: [],
    });

    const actorUser = await this.userRepository.findById(actorUserId);
    await this.businessLogService.logOperation({
      operationType: OperationType.GROUP_CREATE,
      operationCategory: OperationCategory.GROUP_MANAGEMENT,
      actorUserId,
      targetResourceId: group.id,
      targetResourceType: "GROUP",
      description: `用户 '${actorUser?.username || actorUserId}' 创建了用户组 '${group.username}'`,
      success: true,
      ipAddress: this.getClientIP(request),
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });

    return this.mapGroupToDto(group);
  }

  async updateGroup(groupId: string, data: UpdateGroupDto, actorUserId: string, request?: Request): Promise<GroupDto> {
    const existing = await this.groupRepository.findById(groupId);
    if (!existing) throw new NotFoundError("用户组不存在", undefined, { messageKey: "group.notFound" });
    await this.assertIamTargetAccount(existing, actorUserId);

    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.level !== undefined) updateData.level = data.level;
    if (data.description !== undefined) updateData.description = data.description;

    const owner =
      env.security.iamAuthorizationMode === "enforce"
        ? (await this.iamManagementContext(actorUserId)).principal.accountOwnerId
        : undefined;
    const group = await this.groupRepository.updateWithUserCount(groupId, updateData, owner);

    const actorUser = await this.userRepository.findById(actorUserId);
    await this.businessLogService.logOperation({
      operationType: OperationType.GROUP_UPDATE,
      operationCategory: OperationCategory.GROUP_MANAGEMENT,
      actorUserId,
      targetResourceId: groupId,
      targetResourceType: "GROUP",
      description: `用户 '${actorUser?.username || actorUserId}' 更新了用户组 '${group.username}'`,
      changes: updateData,
      success: true,
      ipAddress: this.getClientIP(request),
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });

    return this.mapGroupToDto(group);
  }

  async deleteGroup(groupId: string, actorUserId: string, request?: Request): Promise<void> {
    const group = await this.groupRepository.findByIdWithUserCount(groupId);
    if (!group) throw new NotFoundError("用户组不存在", undefined, { messageKey: "group.notFound" });
    await this.assertIamTargetAccount(group, actorUserId);
    if (group.username === env.security.protectedGroupName)
      throw new BadRequestError("该用户组不允许删除", undefined, { messageKey: "group.notDeletable" });
    if (group._count.users > 0)
      throw new BadRequestError("该组下仍有用户，无法删除", undefined, { messageKey: "group.hasUsers" });

    await this.groupRepository.softDelete(groupId);

    const actorUser = await this.userRepository.findById(actorUserId);
    await this.businessLogService.logOperation({
      operationType: OperationType.GROUP_DELETE,
      operationCategory: OperationCategory.GROUP_MANAGEMENT,
      actorUserId,
      targetResourceId: groupId,
      targetResourceType: "GROUP",
      description: `用户 '${actorUser?.username || actorUserId}' 删除了用户组 '${group.username}'`,
      success: true,
      ipAddress: this.getClientIP(request),
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });
  }

  async getGroupPermissionSnapshot(groupId: string, actorUserId: string) {
    const group = await this.groupRepository.findById(groupId);
    if (!group) throw new NotFoundError("用户组不存在", undefined, { messageKey: "group.notFound" });
    await this.assertIamTargetAccount(group, actorUserId);
    return group;
  }

  async getGroupPermissions(groupId: string, actorUserId?: string): Promise<string[]> {
    const group = await this.groupRepository.findById(groupId);
    if (!group) throw new NotFoundError("用户组不存在", undefined, { messageKey: "group.notFound" });
    await this.assertIamTargetAccount(group, actorUserId);
    const permissions = typeof group.permissions === "string" ? JSON.parse(group.permissions) : group.permissions;
    return Array.isArray(permissions) ? permissions : [];
  }

  async setGroupPermissions(
    groupId: string,
    permissions: string[],
    actorUserId: string,
    request?: Request,
    expected?: GroupPermissionSnapshot,
  ): Promise<void> {
    await PermissionService.getInstance().setGroupPermissions(
      groupId,
      permissions as Permission[],
      actorUserId,
      request,
      expected,
    );
  }
}

import type { GroupDto, CreateGroupDto, UpdateGroupDto, GetAllGroupsData } from "@/api/dto/users/group.dto";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { BadRequestError, NotFoundError } from "@/util/errors";
import { GroupRepository } from "@/store/users/group.repository";
import { UserRepository } from "@/store/users/user.repository";
import type { GroupStore, GroupWithUserCount, GroupListFilters } from "@/store/users/group.store";
import type { UserStore } from "@/store/users/user.store";
import type { Request } from "express";
import { EnvSpace } from "@/config/env";

export class GroupService {
  constructor(
    private readonly groupRepository: GroupStore = GroupRepository.getInstance(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
  ) {}

  private getClientIP(req?: Request): string {
    if (!req) return "unknown";
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return typeof forwarded === "string" ? forwarded.split(",")[0].trim() : forwarded[0];
    return req.ip || req.socket.remoteAddress || "unknown";
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
    const actorUser = await this.userRepository.findById(actorUserId);
    if (!actorUser) return [];

    const actorGroup = await this.groupRepository.findById(actorUser.groupId);
    if (!actorGroup) return [];

    // 如果是 admin 组，返回所有组
    if (actorGroup.username === "admin") return this.getAllGroups();

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
    const actorUser = await this.userRepository.findById(options.actorUserId);
    if (!actorUser) return { groups: [], total: 0, page: options.page, pageSize: options.pageSize, hasMore: false };

    const actorGroup = await this.groupRepository.findById(actorUser.groupId);
    if (!actorGroup) return { groups: [], total: 0, page: options.page, pageSize: options.pageSize, hasMore: false };

    const filters: GroupListFilters = {
      keyword: options.keyword,
      hasRamPermission: options.hasRamPermission,
    };

    // 非管理员只能看到 level >= 自己 level 的组
    if (actorGroup.username !== "admin") filters.minLevel = actorGroup.level;

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

  async getGroupById(id: string): Promise<GroupDto | null> {
    const group = await this.groupRepository.findByIdWithUserCount(id);
    return group ? this.mapGroupToDto(group) : null;
  }

  async createGroup(data: CreateGroupDto, actorUserId: string, request?: Request): Promise<GroupDto> {
    const existing = await this.groupRepository.findByUsername(data.username);
    if (existing) throw new BadRequestError("组标识已存在");

    const group = await this.groupRepository.createWithUserCount({
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
    if (!existing) throw new NotFoundError("用户组不存在");

    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.level !== undefined) updateData.level = data.level;
    if (data.description !== undefined) updateData.description = data.description;

    const group = await this.groupRepository.updateWithUserCount(groupId, updateData);

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
    if (!group) throw new NotFoundError("用户组不存在");
    if (group.username === EnvSpace.protectedGroupName) throw new BadRequestError("该用户组不允许删除");
    if (group._count.users > 0) throw new BadRequestError("该组下仍有用户，无法删除");

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

  async getGroupPermissions(groupId: string): Promise<string[]> {
    const group = await this.groupRepository.findById(groupId);
    if (!group) throw new NotFoundError("用户组不存在");
    const permissions = typeof group.permissions === "string" ? JSON.parse(group.permissions) : group.permissions;
    return Array.isArray(permissions) ? permissions : [];
  }

  async setGroupPermissions(
    groupId: string,
    permissions: string[],
    actorUserId: string,
    request?: Request,
  ): Promise<void> {
    const group = await this.groupRepository.findById(groupId);
    if (!group) throw new NotFoundError("用户组不存在");

    await this.groupRepository.updateById(groupId, { permissions });

    const actorUser = await this.userRepository.findById(actorUserId);
    await this.businessLogService.logOperation({
      operationType: OperationType.GROUP_PERMISSION_UPDATE,
      operationCategory: OperationCategory.PERMISSION,
      actorUserId,
      targetResourceId: groupId,
      targetResourceType: "GROUP",
      description: `用户 '${actorUser?.username || actorUserId}' 更新了用户组 '${group.username}' 的权限`,
      changes: { permissions },
      success: true,
      ipAddress: this.getClientIP(request),
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });
  }
}

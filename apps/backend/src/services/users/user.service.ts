import {
  UserDto,
  CreateUserDto,
  UpdateUserDto,
  UpdateProfileDto,
  ChangeEmailDto,
  GetAllUsersData,
} from "@/api/dto/users/user.dto";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { BadRequestError, NotFoundError, InternalServerError } from "@/util/errors";
import { EmailService } from "@/services/auth/email.service";
import { UserRepository } from "@/store/users/user.repository";
import { GroupRepository } from "@/store/users/group.repository";
import { BusinessLogRepository } from "@/store/system/businesslog";
import type { UserStore, UserListFilters } from "@/store/users/user.store";
import type { GroupStore } from "@/store/users/group.store";
import type { BusinessLogStore } from "@/store/system/businesslog.store";
import type { Request } from "express";
import { NotificationService } from "@/services/notification/notification.service";
import { NotificationPreferenceRepository } from "@/store/notification/notification-preference.repository";
import { NotificationEvent } from "@/constant/notification-event";

type UserEntity = NonNullable<Awaited<ReturnType<UserStore["findById"]>>>;

export class UserService {
  constructor(
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly groupRepository: GroupStore = GroupRepository.getInstance(),
    private readonly businessLogRepository: BusinessLogStore = BusinessLogRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
  ) {}

  /**
   * 获取客户端 IP 地址
   */
  private getClientIP(req?: Request): string {
    if (!req) return "unknown";
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return typeof forwarded === "string" ? forwarded.split(",")[0].trim() : forwarded[0];
    return req.ip || req.socket.remoteAddress || "unknown";
  }

  private async dispatchSecurityNotification(
    userId: string,
    event: NotificationEvent,
    payload: { title: string; content: string; data?: Record<string, unknown> },
  ): Promise<void> {
    try {
      const prefRepo = NotificationPreferenceRepository.getInstance();
      const pref = await prefRepo.findByUserId(userId);
      if (!pref) return;

      const subscribedEvents = (pref.subscribedEvents as string[]) ?? [];
      if (!subscribedEvents.includes(event)) return;

      NotificationService.getInstance().dispatch(userId, event, payload);
    } catch {
      // non-fatal
    }
  }

  /**
   * 将用户实体转换为 UserDto（排除密码字段）
   */
  private async mapUserToDto(user: UserEntity): Promise<UserDto> {
    const [balanceAccount, group] = await Promise.all([
      this.userRepository.findBalanceAccountByUserId(user.id),
      user.groupId ? this.groupRepository.findById(user.groupId) : Promise.resolve(null),
    ]);
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      status: user.status,
      groupId: user.groupId ?? undefined,
      groupName: group?.name || group?.username || null,
      balance: balanceAccount ? Number(balanceAccount.balance) : 0,
      createdAt: user.createTime.toISOString(),
      updatedAt: user.updateTime.toISOString(),
    };
  }

  private async mapUsersToDtos(users: UserEntity[]): Promise<UserDto[]> {
    if (users.length === 0) return [];

    const userIds = users.map((user) => user.id);
    const groupIds = Array.from(
      new Set(users.map((user) => user.groupId).filter((groupId): groupId is string => !!groupId)),
    );

    const [balanceAccounts, groups] = await Promise.all([
      this.userRepository.findBalanceAccountsByUserIds(userIds),
      this.groupRepository.findByIds(groupIds),
    ]);

    const balanceMap = new Map(balanceAccounts.map((account) => [account.userId, account]));
    const groupMap = new Map(groups.map((group) => [group.id, group]));

    return users.map((user) => {
      const balanceAccount = balanceMap.get(user.id);
      const group = user.groupId ? groupMap.get(user.groupId) : null;

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        status: user.status,
        groupId: user.groupId ?? undefined,
        groupName: group?.name || group?.username || null,
        balance: balanceAccount ? Number(balanceAccount.balance) : 0,
        createdAt: user.createTime.toISOString(),
        updatedAt: user.updateTime.toISOString(),
      };
    });
  }

  private async getVisibleUserLevel(userId: string): Promise<number | null> {
    const requestingUser = await this.userRepository.findById(userId);
    if (!requestingUser || !requestingUser.groupId) return null;

    const requestingUserGroup = await this.groupRepository.findById(requestingUser.groupId);
    return requestingUserGroup?.level ?? null;
  }

  async getAllUsers(): Promise<UserDto[]> {
    const users = await this.userRepository.listNonDeleted();
    return this.mapUsersToDtos(users.filter((u) => u.userType !== "ram_user"));
  }

  async getAllLevelGreaterThan(userId: string): Promise<UserDto[]> {
    const visibleLevel = await this.getVisibleUserLevel(userId);
    if (visibleLevel == null) return [];

    const users = await this.userRepository.listNonDeletedByGroupLevelGte(visibleLevel);

    return this.mapUsersToDtos(users.filter((u) => u.userType !== "ram_user"));
  }

  async getVisibleUsersPage(options: {
    actorUserId: string;
    page: number;
    pageSize: number;
    keyword?: string;
    userId?: string;
    groupId?: string;
    excludeCurrentUser?: boolean;
    userType?: string;
    hasRamPermission?: boolean;
  }): Promise<GetAllUsersData> {
    const visibleLevel = await this.getVisibleUserLevel(options.actorUserId);
    if (visibleLevel == null)
      return {
        users: [],
        total: 0,
        page: options.page,
        pageSize: options.pageSize,
        hasMore: false,
      };

    const filters: UserListFilters = {
      keyword: options.keyword,
      userId: options.userId,
      groupId: options.groupId,
      excludeUserId: options.excludeCurrentUser ? options.actorUserId : undefined,
      userType: options.userType,
      hasRamPermission: options.hasRamPermission,
    };
    // Only exclude ram_user by default when no explicit userType filter is provided
    if (!options.userType && !options.hasRamPermission) filters.excludeUserType = "ram_user";

    const skip = (options.page - 1) * options.pageSize;

    const [total, users] = await Promise.all([
      this.userRepository.countNonDeletedByGroupLevelGte(visibleLevel, filters),
      this.userRepository.listNonDeletedByGroupLevelGtePaginated(visibleLevel, {
        ...filters,
        skip,
        take: options.pageSize,
      }),
    ]);

    const userDtos = await this.mapUsersToDtos(users);

    return {
      users: userDtos,
      total,
      page: options.page,
      pageSize: options.pageSize,
      hasMore: skip + userDtos.length < total,
    };
  }

  async getUserById(id: string): Promise<UserDto | null> {
    const user = await this.userRepository.findById(id);
    return user ? await this.mapUserToDto(user) : null;
  }

  async createUser(
    data: CreateUserDto & { password: string; groupId?: string },
    actorUserId: string,
    request?: Request,
  ): Promise<UserDto> {
    // Check username uniqueness
    const existing = await this.userRepository.findByUsername(data.username);
    if (existing) throw new BadRequestError("用户名已存在");

    // If no groupId, use default group (username: "user")
    let groupId = data.groupId;
    if (!groupId) {
      const defaultGroup = await this.groupRepository.findDefaultUserGroup();
      if (!defaultGroup) throw new InternalServerError("默认用户组不存在");
      groupId = defaultGroup.id;
    }

    const user = await this.userRepository.create({
      username: data.username,
      password: data.password,
      email: data.email || null,
      name: data.name || null,
      groupId,
      permissionAdds: [],
      permissionRemoves: [],
    });

    const actorUser = await this.userRepository.findById(actorUserId);
    await this.businessLogService.logOperation({
      operationType: OperationType.USER_CREATE,
      operationCategory: OperationCategory.USER_MANAGEMENT,
      actorUserId,
      targetUserId: user.id,
      targetResourceType: "USER",
      description: `用户 '${actorUser?.username || actorUserId}' 创建了用户 '${user.username}'`,
      success: true,
      ipAddress: this.getClientIP(request),
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });

    return await this.mapUserToDto(user);
  }

  async updateUser(userId: string, data: UpdateUserDto, actorUserId: string, request?: Request): Promise<UserDto> {
    const existingUser = await this.userRepository.findById(userId);
    if (!existingUser) throw new NotFoundError("用户不存在");

    const updateData: Record<string, any> = {};
    if (data.email !== undefined) updateData.email = data.email;
    if (data.name !== undefined) updateData.name = data.name;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.groupId !== undefined) updateData.groupId = data.groupId;

    const user = await this.userRepository.updateById(userId, updateData);

    const hasStatusChange = data.status !== undefined;
    const actorUser = await this.userRepository.findById(actorUserId);
    await this.businessLogService.logOperation({
      operationType: hasStatusChange ? OperationType.USER_STATUS_CHANGE : OperationType.USER_UPDATE,
      operationCategory: OperationCategory.USER_MANAGEMENT,
      actorUserId,
      targetUserId: userId,
      targetResourceType: "USER",
      description: hasStatusChange
        ? `用户 '${actorUser?.username || actorUserId}' 将用户 '${user.username}' 状态变更为 ${data.status}`
        : `用户 '${actorUser?.username || actorUserId}' 更新了用户 '${user.username}' 的信息`,
      changes: updateData,
      success: true,
      ipAddress: this.getClientIP(request),
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });

    // Fire-and-forget: notify the target user about account status change
    if (hasStatusChange && data.status !== undefined) {
      const oldStatus = existingUser.status;
      const newStatus = data.status;
      this.dispatchSecurityNotification(userId, NotificationEvent.ACCOUNT_STATUS_CHANGED, {
        title: "账户状态变更",
        content: `您的账户状态已由「${oldStatus}」变更为「${newStatus}」。如有疑问，请联系管理员。`,
        data: { oldStatus, newStatus },
      }).catch(() => {});
    }

    return await this.mapUserToDto(user);
  }

  async deleteUser(userId: string, actorUserId: string, request?: Request): Promise<void> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError("用户不存在");

    // Soft delete: mark the account as deleted via AccountStatus.DELETED.
    await this.userRepository.softDelete(userId);

    const actorUser = await this.userRepository.findById(actorUserId);
    await this.businessLogService.logOperation({
      operationType: OperationType.USER_DELETE,
      operationCategory: OperationCategory.USER_MANAGEMENT,
      actorUserId,
      targetUserId: userId,
      targetResourceType: "USER",
      description: `用户 '${actorUser?.username || actorUserId}' 删除了用户 '${user.username}'`,
      success: true,
      ipAddress: this.getClientIP(request),
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });
  }

  async getUserGroupLevel(userId: string): Promise<number | null> {
    const user = await this.userRepository.findById(userId);
    if (!user || !user.groupId) return null;
    const group = await this.groupRepository.findById(user.groupId);
    return group?.level ?? null;
  }

  /**
   * 检查用户是否属于管理员组（admin 组）
   * 管理员组可以修改所有用户组权限，包括同等级的组
   */
  async isAdmin(userId: string): Promise<boolean> {
    const user = await this.userRepository.findById(userId);
    if (!user || !user.groupId) return false;
    const group = await this.groupRepository.findById(user.groupId);
    return group?.username === "admin";
  }

  async changeUserPassword(
    userId: string,
    newPasswordHash: string,
    actorUserId?: string,
    request?: Request,
  ): Promise<void> {
    const [targetUser, actorUser] = await Promise.all([
      this.userRepository.findById(userId),
      actorUserId ? this.userRepository.findById(actorUserId) : Promise.resolve(null),
    ]);

    await this.userRepository.updateById(userId, { password: newPasswordHash });

    const isSelf = actorUserId === userId;
    await this.businessLogService.logOperation({
      operationType: OperationType.PASSWORD_CHANGE,
      operationCategory: OperationCategory.AUTH,
      actorUserId: actorUserId || userId,
      targetUserId: userId,
      targetResourceType: "USER",
      description: isSelf
        ? `用户 '${targetUser?.username || userId}' 修改了自己的密码`
        : `用户 '${actorUser?.username || actorUserId}' 修改了用户 '${targetUser?.username || userId}' 的密码`,
      success: true,
      ipAddress: this.getClientIP(request),
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });

    // Fire-and-forget: notify the target user about password change
    this.dispatchSecurityNotification(userId, NotificationEvent.PASSWORD_CHANGED, {
      title: "密码已修改",
      content: isSelf
        ? "您的账户密码已成功修改。如非本人操作，请立即联系管理员。"
        : "您的账户密码已被管理员修改，请及时登录确认。",
      data: { isSelf },
    }).catch(() => {});
  }

  /**
   * 用户修改自己的姓名
   */
  async updateProfile(userId: string, data: UpdateProfileDto, request?: Request): Promise<UserDto> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError("用户不存在");

    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;

    const updatedUser = await this.userRepository.updateById(userId, updateData);

    await this.businessLogService.logOperation({
      operationType: OperationType.USER_PROFILE_UPDATE,
      operationCategory: OperationCategory.USER_MANAGEMENT,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceType: "USER",
      description: `用户 '${user.username}' 更新了个人资料`,
      changes: updateData,
      success: true,
      ipAddress: this.getClientIP(request),
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });

    return await this.mapUserToDto(updatedUser);
  }

  /**
   * 发送邮箱变更验证码
   */
  async sendEmailChangeCode(userId: string, newEmail: string, request?: Request): Promise<void> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError("用户不存在");

    // 不允许设为当前邮箱
    if (user.email && user.email.toLowerCase() === newEmail.toLowerCase())
      throw new BadRequestError("新邮箱不能与当前邮箱相同");

    // 检查邮箱唯一性
    const emailExists = await this.userRepository.findByEmailInNonDeleted(newEmail);
    if (emailExists) throw new BadRequestError("该邮箱已被其他用户使用");

    // 检查一天内是否已经更换过邮箱（通过业务日志检查）
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentEmailChange = await this.businessLogRepository.findRecentSuccessfulOperation(
      userId,
      OperationType.USER_EMAIL_CHANGE,
      oneDayAgo,
    );
    if (recentEmailChange) throw new BadRequestError("每天只能修改一次邮箱，请明天再试");

    // 发送验证码到新邮箱
    const emailService = EmailService.getInstance();
    await emailService.sendVerificationCode(newEmail);
  }

  /**
   * 通过验证码更换邮箱
   */
  async changeEmail(userId: string, data: ChangeEmailDto, request?: Request): Promise<void> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError("用户不存在");

    // 不允许设为当前邮箱
    if (user.email && user.email.toLowerCase() === data.newEmail.toLowerCase())
      throw new BadRequestError("新邮箱不能与当前邮箱相同");

    // 检查邮箱唯一性
    const emailExists = await this.userRepository.findByEmailInNonDeleted(data.newEmail);
    if (emailExists) throw new BadRequestError("该邮箱已被其他用户使用");

    // 检查一天内是否已经更换过邮箱
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentEmailChange = await this.businessLogRepository.findRecentSuccessfulOperation(
      userId,
      OperationType.USER_EMAIL_CHANGE,
      oneDayAgo,
    );
    if (recentEmailChange) throw new BadRequestError("每天只能修改一次邮箱，请明天再试");

    // 验证验证码
    const emailService = EmailService.getInstance();
    const isValid = await emailService.verifyCode(data.newEmail, data.verificationCode);
    if (!isValid) throw new BadRequestError("验证码无效或已过期");

    const oldEmail = user.email;

    // 更新邮箱
    await this.userRepository.updateById(userId, { email: data.newEmail });

    await this.businessLogService.logOperation({
      operationType: OperationType.USER_EMAIL_CHANGE,
      operationCategory: OperationCategory.USER_MANAGEMENT,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceType: "USER",
      description: `用户 '${user.username}' 将邮箱从 '${oldEmail || "无"}' 更改为 '${data.newEmail}'`,
      changes: { oldEmail, newEmail: data.newEmail },
      success: true,
      ipAddress: this.getClientIP(request),
      userAgent: request?.headers["user-agent"],
      requestId: request?.headers["x-request-id"] as string | undefined,
    });
  }
}

import { randomBytes } from "crypto";
import type { RamRole, User } from "@prisma/client";
import { Permission } from "@/constant/permission";
import { AccountStatus } from "@/util/auth/account-status";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/util/errors";
import { hashPassword } from "@/util/crypto";
import { JWTAccessIns } from "@/util/auth";
import { isValidPermission } from "@/util/permission/validation";
import { PermissionService } from "@/services/users/permission.service";
import { UserRepository } from "@/store/users/user.repository";
import { GroupRepository } from "@/store/users/group.repository";
import { RamRoleRepository } from "@/store/users/ram-role.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { AccessKeyRepository } from "@/store/users/accesskey.repository";
import { NotificationPreferenceRepository } from "@/store/notification/notification-preference.repository";
import { NotificationService } from "@/services/notification/notification.service";
import { NotificationEvent } from "@/constant/notification-event";
import { env } from "@/config/env";
import type { UserStore } from "@/store/users/user.store";
import type { GroupStore } from "@/store/users/group.store";
import type { AccessKeyStore } from "@/store/users/accesskey.store";
import type { RamRoleStore, RamRoleBindingRecord, ActiveRamRoleSession } from "@/store/users/ram-role.store";
import type { RamPolicyStore } from "@/store/users/ram-policy.store";
import type {
  AssumeRamRoleDto,
  AssumeRamRoleResponseDto,
  AttachPolicyBodyDto,
  CreateRamPolicyDto,
  CreateRamRoleDto,
  CreateRamUserDto,
  EffectivePermissionDto,
  RamGroupDto,
  RamPolicyAttachmentDto,
  RamPolicyDto,
  RamRoleBindingDto,
  RamRoleDto,
  RamRoleSessionDto,
  RamUserDto,
  UpdateRamPolicyDto,
  UpdateRamRoleDto,
  UpdateRamUserDto,
} from "@/api/dto/users/ram.dto";

const DEFAULT_ROLE_SESSION_DURATION_SECONDS = 3600;

type AccountScopedUser = User & {
  accountOwnerId?: string | null;
  userType?: string | null;
};

function normalizeJsonStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export class RamService {
  constructor(
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly groupRepository: GroupStore = GroupRepository.getInstance(),
    private readonly ramRoleRepository: RamRoleStore = RamRoleRepository.getInstance(),
    private readonly ramPolicyRepository: RamPolicyStore = RamPolicyRepository.getInstance(),
    private readonly accessKeyRepository: AccessKeyStore = AccessKeyRepository.getInstance(),
    private readonly permissionService: PermissionService = PermissionService.getInstance(),
  ) {}

  private static instance: RamService;

  static getInstance(): RamService {
    if (!RamService.instance) RamService.instance = new RamService();
    return RamService.instance;
  }

  private resolveAccountOwnerId(user: AccountScopedUser): string {
    return user.accountOwnerId || user.id;
  }

  private async getActor(actorUserId: string): Promise<AccountScopedUser> {
    const actor = await this.userRepository.findById(actorUserId);
    if (!actor) throw new NotFoundError("操作者用户不存在", undefined, { messageKey: "ram.actorNotFound" });
    if (actor.status !== AccountStatus.ACTIVE)
      throw new ForbiddenError("操作者账户不可用", undefined, { messageKey: "ram.actorUnavailable" });
    return actor as AccountScopedUser;
  }

  private async getAccountOwnerId(actorUserId: string): Promise<string> {
    const actor = await this.getActor(actorUserId);
    return this.resolveAccountOwnerId(actor);
  }

  private assertSameAccount(accountOwnerId: string, resourceAccountOwnerId?: string | null): void {
    const normalized = resourceAccountOwnerId || undefined;
    if (normalized && normalized !== accountOwnerId)
      throw new ForbiddenError("无权访问其他主账号下的资源", undefined, {
        messageKey: "ram.crossAccountResourceForbidden",
      });
  }

  private normalizePolicyPermissions(permissions: string[]): Permission[] {
    const invalidPermissions = permissions.filter((permission) => !isValidPermission(permission));
    if (invalidPermissions.length > 0)
      throw new BadRequestError(`无效的权限: ${invalidPermissions.join(", ")}`, undefined, {
        messageKey: "ram.invalidPermissions",
        messageParams: { permissions: invalidPermissions.join(", ") },
      });
    return [...new Set(permissions as Permission[])];
  }

  private async assertCanUsePolicyPermissions(actorUserId: string, permissions: string[]): Promise<Permission[]> {
    const normalizedPermissions = this.normalizePolicyPermissions(permissions);
    await this.permissionService.assertCanGrantPermissions(actorUserId, normalizedPermissions);
    return normalizedPermissions;
  }

  private async assertPolicyTargetInAccount(
    accountOwnerId: string,
    targetType: AttachPolicyBodyDto["targetType"],
    targetId: string,
  ): Promise<void> {
    if (targetType === "user") {
      const user = await this.userRepository.findById(targetId);
      if (!user) throw new NotFoundError("用户不存在", undefined, { messageKey: "ram.userNotFound" });
      if (user.status !== AccountStatus.ACTIVE)
        throw new NotFoundError("用户不存在", undefined, { messageKey: "ram.userNotFound" });
      this.assertSameAccount(accountOwnerId, user.accountOwnerId || user.parentUserId || user.id);
      return;
    }

    if (targetType === "group") {
      const group = await this.groupRepository.findById(targetId);
      if (!group) throw new NotFoundError("用户组不存在", undefined, { messageKey: "ram.groupNotFound" });
      if (group.status !== AccountStatus.ACTIVE)
        throw new NotFoundError("用户组不存在", undefined, { messageKey: "ram.groupNotFound" });
      this.assertSameAccount(accountOwnerId, group.accountOwnerId);
      return;
    }

    const role = await this.ramRoleRepository.findRoleById(targetId);
    if (!role) throw new NotFoundError("角色不存在", undefined, { messageKey: "ram.roleNotFound" });
    this.assertSameAccount(accountOwnerId, role.accountOwnerId);
  }

  private async assertPolicyAttachmentScope(actorUserId: string, data: AttachPolicyBodyDto) {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const policy = await this.ramPolicyRepository.findPolicyById(data.policyId);
    if (!policy) throw new NotFoundError("权限策略不存在", undefined, { messageKey: "ram.policyNotFound" });
    this.assertSameAccount(accountOwnerId, policy.accountOwnerId);
    await this.assertPolicyTargetInAccount(accountOwnerId, data.targetType, data.targetId);
    return { accountOwnerId, policy };
  }

  private async dispatchNotification(
    actorUserId: string,
    event: NotificationEvent,
    payload: { title: string; content: string; data?: Record<string, unknown> },
  ): Promise<void> {
    try {
      const prefRepo = NotificationPreferenceRepository.getInstance();
      const pref = await prefRepo.findByUserId(actorUserId);
      if (!pref) return;

      const subscribedEvents = (pref.subscribedEvents as string[]) ?? [];
      if (!subscribedEvents.includes(event)) return;

      NotificationService.getInstance().dispatch(actorUserId, event, payload);
    } catch {
      // non-fatal
    }
  }

  private mapUserToDto(
    user: AccountScopedUser,
    accessKeyId?: string | null,
    accessKeySecret?: string | null,
  ): RamUserDto {
    return {
      id: user.id,
      username: user.username,
      ramUsername: user.ramUsername ?? null,
      displayName: user.displayName ?? null,
      email: user.email,
      name: user.name,
      status: user.status,
      groupId: user.groupId,
      accountOwnerId: user.accountOwnerId ?? null,
      parentUserId: user.parentUserId ?? null,
      userType: user.userType ?? null,
      createdAt: user.createTime.toISOString(),
      updatedAt: user.updateTime.toISOString(),
      accessKeyId: accessKeyId ?? null,
      accessKeySecret: accessKeySecret ?? null,
      forcePasswordChange: ((user as Record<string, unknown>).forcePasswordChange as boolean | null) ?? null,
    };
  }

  private mapRoleToDto(role: RamRole, permissions: string[]): RamRoleDto {
    return {
      id: role.id,
      accountOwnerId: role.accountOwnerId,
      name: role.name,
      description: role.description,
      permissions,
      trustPolicy: (role.trustPolicy as Record<string, unknown> | null) ?? null,
      maxSessionDuration: role.maxSessionDuration,
      status: role.status,
      createdAt: role.createTime.toISOString(),
      updatedAt: role.updateTime.toISOString(),
    };
  }

  private mapBindingToDto(binding: RamRoleBindingRecord): RamRoleBindingDto {
    return {
      id: binding.id,
      roleId: binding.roleId,
      roleName: binding.roleName,
      permissions: binding.permissions,
      source: binding.source,
      principalId: binding.principalId,
    };
  }

  private mapSessionToDto(session: ActiveRamRoleSession): RamRoleSessionDto {
    return {
      id: session.id,
      accountOwnerId: session.accountOwnerId,
      subjectUserId: session.subjectUserId,
      roleId: session.roleId,
      roleName: session.role.name,
      sessionName: session.sessionName,
      expiresAt: session.expiresAt.toISOString(),
      status: session.status,
      createdAt: session.createTime.toISOString(),
    };
  }

  async listRamUsers(actorUserId: string): Promise<RamUserDto[]> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const actor = await this.getActor(actorUserId);
    const actorGroup = actor.groupId ? await this.groupRepository.findById(actor.groupId) : null;
    const isAdmin = actorGroup?.username === env.security.superAdminGroupUsername;

    const users = isAdmin
      ? await this.userRepository.listNonDeleted()
      : await this.userRepository.listNonDeletedByGroupLevelGte(actorGroup?.level ?? 0);

    return users
      .filter(
        (user) =>
          user.userType === "ram_user" &&
          (user.accountOwnerId === accountOwnerId || user.parentUserId === accountOwnerId),
      )
      .map((user) => this.mapUserToDto(user as AccountScopedUser));
  }

  async listVisibleGroups(
    actorUserId: string,
    options?: { page?: number; pageSize?: number; keyword?: string },
  ): Promise<RamGroupDto[]> {
    const actor = await this.getActor(actorUserId);
    const actorGroup = actor.groupId ? await this.groupRepository.findById(actor.groupId) : null;
    const isAdmin = actorGroup?.username === env.security.superAdminGroupUsername;

    const groups = isAdmin
      ? await this.groupRepository.listActiveWithUserCount()
      : await this.groupRepository.listVisibleWithUserCount(actorGroup?.level ?? 0);

    const filtered = options?.keyword
      ? groups.filter(
          (g) => (g.name && g.name.includes(options.keyword!)) || (g.username && g.username.includes(options.keyword!)),
        )
      : groups;

    return filtered.map((g) => ({
      id: g.id,
      username: g.username,
      name: g.name,
      permissions: normalizeJsonStringArray(g.permissions),
      level: g.level,
      description: g.description,
      userCount: g._count?.users,
      createdAt: g.createTime.toISOString(),
      updatedAt: g.updateTime.toISOString(),
    }));
  }

  async createRamUser(actorUserId: string, data: CreateRamUserDto): Promise<RamUserDto> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const enableConsole = data.enableConsole !== false; // 默认 true
    const enableAccessKey = data.enableAccessKey === true; // 默认 false

    if (!enableConsole && !enableAccessKey)
      throw new BadRequestError("至少需要启用一种访问方式（控制台或 AccessKey）", undefined, {
        messageKey: "ram.consoleOrAccessKeyRequired",
      });

    const existing = await this.userRepository.findByUsername(data.username);
    if (existing) throw new BadRequestError("用户名已存在", undefined, { messageKey: "ram.usernameExists" });

    if (data.groupId) {
      const group = await this.groupRepository.findById(data.groupId);
      if (!group) throw new NotFoundError("用户组不存在", undefined, { messageKey: "ram.groupNotFound" });
      this.assertSameAccount(accountOwnerId, group.accountOwnerId);
    }

    // 仅 AccessKey 或无密码时生成随机密码
    const rawPassword = data.password ?? randomBytes(12).toString("hex");
    const password = await hashPassword(rawPassword);

    const user = await this.userRepository.create({
      username: data.username,
      password,
      email: data.email ?? null,
      name: data.name ?? null,
      groupId: data.groupId ?? null,
      permissionAdds: [],
      permissionRemoves: [],
      accountOwnerId,
      parentUserId: accountOwnerId,
      userType: "ram_user",
      ramUsername: data.ramUsername ?? data.username,
      displayName: data.displayName ?? data.name ?? data.username,
      forcePasswordChange: data.passwordResetRequired ?? false,
    });

    // AccessKey 为该用户创建 AccessKey
    if (enableAccessKey) {
      const key = "ak_" + randomBytes(32).toString("hex");
      const accessKey = await this.accessKeyRepository.create({
        userId: user.id,
        key,
        name: `RAM-${data.ramUsername ?? data.username}`,
      });
      void this.dispatchNotification(actorUserId, NotificationEvent.RAM_USER_CREATED, {
        title: "RAM用户已创建",
        content: `RAM用户 "${data.ramUsername || data.username}" 已成功创建（含 AccessKey）。`,
        data: { userId: user.id, ramUsername: data.ramUsername || data.username },
      });
      return this.mapUserToDto(user as AccountScopedUser, accessKey.id, key);
    }

    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_USER_CREATED, {
      title: "RAM用户已创建",
      content: `RAM用户 "${data.ramUsername || data.username}" 已成功创建。`,
      data: { userId: user.id, ramUsername: data.ramUsername || data.username },
    });
    return this.mapUserToDto(user as AccountScopedUser);
  }

  async updateRamUser(actorUserId: string, userId: string, data: UpdateRamUserDto): Promise<RamUserDto> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError("RAM用户不存在", undefined, { messageKey: "ram.ramUserNotFound" });
    this.assertSameAccount(accountOwnerId, user.accountOwnerId || user.parentUserId);

    if (data.groupId) {
      const group = await this.groupRepository.findById(data.groupId);
      if (!group) throw new NotFoundError("用户组不存在", undefined, { messageKey: "ram.groupNotFound" });
      this.assertSameAccount(accountOwnerId, group.accountOwnerId);
    }

    const updateData: Record<string, unknown> = {};
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.name !== undefined) updateData.name = data.name;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.groupId !== undefined) updateData.groupId = data.groupId;

    const updated = await this.userRepository.updateById(userId, updateData);
    return this.mapUserToDto(updated as AccountScopedUser);
  }

  async deleteRamUser(actorUserId: string, userId: string): Promise<void> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError("RAM用户不存在", undefined, { messageKey: "ram.ramUserNotFound" });
    if (user.id === accountOwnerId)
      throw new BadRequestError("不能删除主账号", undefined, { messageKey: "ram.cannotDeleteAccountOwner" });
    this.assertSameAccount(accountOwnerId, user.accountOwnerId || user.parentUserId);
    await this.userRepository.softDelete(userId);

    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_USER_DELETED, {
      title: "RAM用户已删除",
      content: `RAM用户 "${user.ramUsername || user.username}" 已被删除。`,
      data: { userId, ramUsername: user.ramUsername },
    });
  }

  async listRoles(actorUserId: string): Promise<RamRoleDto[]> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const roles = await this.ramRoleRepository.listRoles(accountOwnerId);
    const roleIds = roles.map((r) => r.id);
    const permissionsMap = await this.aggregateRolePermissionsFromPolicies(roleIds);
    return roles.map((role) => this.mapRoleToDto(role, permissionsMap.get(role.id) || []));
  }

  private async aggregateRolePermissionsFromPolicies(roleIds: string[]): Promise<Map<string, string[]>> {
    if (roleIds.length === 0) return new Map();
    const attachments = await this.ramPolicyRepository.listPoliciesForTargets("role", roleIds);
    const map = new Map<string, string[]>();
    for (const a of attachments) {
      const existing = map.get(a.targetId) || [];
      map.set(a.targetId, [...existing, ...a.permissions]);
    }
    // Deduplicate
    for (const [roleId, perms] of map) {
      map.set(roleId, [...new Set(perms)]);
    }
    return map;
  }

  async createRole(actorUserId: string, data: CreateRamRoleDto): Promise<RamRoleDto> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const existing = await this.ramRoleRepository.findRoleByName(accountOwnerId, data.name);
    if (existing) throw new BadRequestError("角色名称已存在", undefined, { messageKey: "ram.roleNameExists" });

    const role = await this.ramRoleRepository.createRole({
      accountOwnerId,
      name: data.name,
      description: data.description ?? null,
      trustPolicy: data.trustPolicy ?? null,
      maxSessionDuration: data.maxSessionDuration ?? DEFAULT_ROLE_SESSION_DURATION_SECONDS,
    });
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_ROLE_CREATED, {
      title: "RAM角色已创建",
      content: `角色 "${data.name}" 已成功创建。`,
      data: { roleId: role.id, roleName: data.name },
    });
    return this.mapRoleToDto(role, []);
  }

  async updateRole(actorUserId: string, roleId: string, data: UpdateRamRoleDto): Promise<RamRoleDto> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const role = await this.ramRoleRepository.findRoleById(roleId);
    if (!role) throw new NotFoundError("角色不存在", undefined, { messageKey: "ram.roleNotFound" });
    this.assertSameAccount(accountOwnerId, role.accountOwnerId);

    const updated = await this.ramRoleRepository.updateRole(roleId, data);
    const permissions = await this.ramPolicyRepository.listPoliciesForTarget("role", roleId);
    return this.mapRoleToDto(
      updated,
      permissions.flatMap((p) => p.permissions),
    );
  }

  async deleteRole(actorUserId: string, roleId: string): Promise<void> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const role = await this.ramRoleRepository.findRoleById(roleId);
    if (!role) throw new NotFoundError("角色不存在", undefined, { messageKey: "ram.roleNotFound" });
    this.assertSameAccount(accountOwnerId, role.accountOwnerId);
    await this.ramRoleRepository.softDeleteRole(roleId);
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_ROLE_DELETED, {
      title: "RAM角色已删除",
      content: `角色 "${role.name}" 已被删除。`,
      data: { roleId, roleName: role.name },
    });
  }

  async bindRoleToUser(actorUserId: string, roleId: string, userId: string): Promise<void> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const [role, user] = await Promise.all([
      this.ramRoleRepository.findRoleById(roleId),
      this.userRepository.findById(userId),
    ]);
    if (!role) throw new NotFoundError("角色不存在", undefined, { messageKey: "ram.roleNotFound" });
    if (!user) throw new NotFoundError("用户不存在", undefined, { messageKey: "ram.userNotFound" });
    this.assertSameAccount(accountOwnerId, role.accountOwnerId);
    this.assertSameAccount(accountOwnerId, user.accountOwnerId || user.parentUserId);
    await this.ramRoleRepository.bindRoleToUser(accountOwnerId, roleId, userId);
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_ROLE_BINDING_UPDATED, {
      title: "角色已绑定到用户",
      content: `角色 "${role.name}" 已成功绑定到用户。`,
      data: { roleId, userId },
    });
  }

  async unbindRoleFromUser(actorUserId: string, roleId: string, userId: string): Promise<void> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const role = await this.ramRoleRepository.findRoleById(roleId);
    if (!role) throw new NotFoundError("角色不存在", undefined, { messageKey: "ram.roleNotFound" });
    this.assertSameAccount(accountOwnerId, role.accountOwnerId);
    await this.ramRoleRepository.unbindRoleFromUser(roleId, userId);
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_ROLE_BINDING_UPDATED, {
      title: "角色已从用户解绑",
      content: `角色 "${role.name}" 已从用户解绑。`,
      data: { roleId, userId },
    });
  }

  async bindRoleToGroup(actorUserId: string, roleId: string, groupId: string): Promise<void> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const [role, group] = await Promise.all([
      this.ramRoleRepository.findRoleById(roleId),
      this.groupRepository.findById(groupId),
    ]);
    if (!role) throw new NotFoundError("角色不存在", undefined, { messageKey: "ram.roleNotFound" });
    if (!group) throw new NotFoundError("用户组不存在", undefined, { messageKey: "ram.groupNotFound" });
    this.assertSameAccount(accountOwnerId, role.accountOwnerId);
    this.assertSameAccount(accountOwnerId, group.accountOwnerId);
    await this.ramRoleRepository.bindRoleToGroup(accountOwnerId, roleId, groupId);
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_ROLE_BINDING_UPDATED, {
      title: "角色已绑定到用户组",
      content: `角色 "${role.name}" 已成功绑定到用户组。`,
      data: { roleId, groupId },
    });
  }

  async unbindRoleFromGroup(actorUserId: string, roleId: string, groupId: string): Promise<void> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const role = await this.ramRoleRepository.findRoleById(roleId);
    if (!role) throw new NotFoundError("角色不存在", undefined, { messageKey: "ram.roleNotFound" });
    this.assertSameAccount(accountOwnerId, role.accountOwnerId);
    await this.ramRoleRepository.unbindRoleFromGroup(roleId, groupId);
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_ROLE_BINDING_UPDATED, {
      title: "角色已从用户组解绑",
      content: `角色 "${role.name}" 已从用户组解绑。`,
      data: { roleId, groupId },
    });
  }

  async listRoleBindings(actorUserId: string, roleId: string, userId?: string): Promise<RamRoleBindingDto[]> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const role = await this.ramRoleRepository.findRoleById(roleId);
    if (!role) throw new NotFoundError("角色不存在", undefined, { messageKey: "ram.roleNotFound" });
    this.assertSameAccount(accountOwnerId, role.accountOwnerId);

    if (!userId) {
      const roleWithBindings = await this.ramRoleRepository.listRoleBindingsByRole(roleId);
      if (!roleWithBindings) return [];
      const policyBindings = await this.ramPolicyRepository.listPoliciesForTarget("role", roleId);
      const permissions = [...new Set(policyBindings.flatMap((b) => b.permissions))];
      return [
        ...roleWithBindings.userBindings.map((binding) =>
          this.mapBindingToDto({
            id: binding.id,
            roleId,
            roleName: roleWithBindings.name,
            permissions,
            source: "user",
            principalId: binding.userId,
          }),
        ),
        ...roleWithBindings.groupBindings.map((binding) =>
          this.mapBindingToDto({
            id: binding.id,
            roleId,
            roleName: roleWithBindings.name,
            permissions,
            source: "group",
            principalId: binding.groupId,
          }),
        ),
      ];
    }

    const targetUser = userId
      ? await this.userRepository.findById(userId)
      : await this.userRepository.findById(actorUserId);
    if (!targetUser) throw new NotFoundError("用户不存在", undefined, { messageKey: "ram.userNotFound" });
    this.assertSameAccount(accountOwnerId, targetUser.accountOwnerId || targetUser.parentUserId || targetUser.id);
    const bindings = await this.ramRoleRepository.listRoleBindingsForUser(targetUser.id, targetUser.groupId);
    return bindings.filter((binding) => binding.roleId === roleId).map((binding) => this.mapBindingToDto(binding));
  }

  async assumeRole(actorUserId: string, data: AssumeRamRoleDto): Promise<AssumeRamRoleResponseDto> {
    const actor = await this.getActor(actorUserId);
    const accountOwnerId = this.resolveAccountOwnerId(actor);
    const role = await this.ramRoleRepository.findRoleById(data.roleId);
    if (!role) throw new NotFoundError("角色不存在", undefined, { messageKey: "ram.roleNotFound" });
    this.assertSameAccount(accountOwnerId, role.accountOwnerId);

    const bindings = await this.ramRoleRepository.listRoleBindingsForUser(actor.id, actor.groupId);
    const canAssume = bindings.some((binding) => binding.roleId === role.id) || actor.id === accountOwnerId;
    if (!canAssume)
      throw new ForbiddenError("当前用户未绑定该角色，无法扮演", undefined, {
        messageKey: "ram.cannotAssumeUnboundRole",
      });

    const durationSeconds = Math.min(
      data.durationSeconds ?? DEFAULT_ROLE_SESSION_DURATION_SECONDS,
      role.maxSessionDuration,
    );
    const expiresAt = new Date(Date.now() + durationSeconds * 1000);
    const session = await this.ramRoleRepository.createRoleSession({
      accountOwnerId,
      subjectUserId: actor.id,
      roleId: role.id,
      sessionName: data.sessionName ?? `${role.name}-${Date.now()}`,
      expiresAt,
    });

    const accessToken = JWTAccessIns.generateToken(
      {
        userId: actor.id,
        updatedAt: actor.updateTime.toISOString(),
        status: actor.status,
        principalUserId: actor.id,
        accountOwnerId,
        subjectType: actor.id === accountOwnerId ? "root" : "sub_user",
        assumedRoleId: role.id,
        roleSessionId: session.id,
      },
      durationSeconds,
    );

    return {
      accessToken,
      expiresAt: expiresAt.toISOString(),
      session: this.mapSessionToDto(session),
    };
  }

  async listRoleSessions(actorUserId: string, principalUserId?: string): Promise<RamRoleSessionDto[]> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const sessions = await this.ramRoleRepository.listActiveRoleSessions(accountOwnerId, principalUserId);
    return sessions.map((session) => this.mapSessionToDto(session));
  }

  async revokeRoleSession(actorUserId: string, sessionId: string): Promise<void> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const session = await this.ramRoleRepository.findActiveRoleSession(sessionId);
    if (!session)
      throw new NotFoundError("角色会话不存在或已过期", undefined, { messageKey: "ram.roleSessionNotFound" });
    this.assertSameAccount(accountOwnerId, session.accountOwnerId);
    await this.ramRoleRepository.revokeRoleSession(sessionId);
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_ROLE_BINDING_UPDATED, {
      title: "角色会话已撤销",
      content: `角色 "${session.role.name}" 的会话已被撤销。`,
      data: { sessionId, roleId: session.roleId },
    });
  }

  async getAssumedRoleSession(sessionId: string): Promise<ActiveRamRoleSession | null> {
    return this.ramRoleRepository.findActiveRoleSession(sessionId);
  }

  // ── 权限策略 ──

  private mapPolicyToDto(policy: {
    id: string;
    accountOwnerId: string;
    name: string;
    description: string | null;
    permissions: unknown;
    type: string;
    status: number;
    createTime: Date;
    updateTime: Date;
  }): RamPolicyDto {
    return {
      id: policy.id,
      accountOwnerId: policy.accountOwnerId,
      name: policy.name,
      description: policy.description ?? undefined,
      permissions: normalizeJsonStringArray(policy.permissions).filter((permission): permission is Permission =>
        isValidPermission(permission),
      ),
      type: policy.type,
      status: policy.status,
      createTime: policy.createTime.toISOString(),
      updateTime: policy.updateTime.toISOString(),
    };
  }

  async listPolicies(actorUserId: string): Promise<RamPolicyDto[]> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const policies = await this.ramPolicyRepository.listPolicies(accountOwnerId);
    return policies.map((p) => this.mapPolicyToDto(p));
  }

  async createPolicy(actorUserId: string, data: CreateRamPolicyDto): Promise<RamPolicyDto> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const existing = await this.ramPolicyRepository.findPolicyByName(accountOwnerId, data.name);
    if (existing) throw new BadRequestError("权限策略名称已存在", undefined, { messageKey: "ram.policyNameExists" });
    const permissions = await this.assertCanUsePolicyPermissions(actorUserId, data.permissions);

    const policy = await this.ramPolicyRepository.createPolicy({
      accountOwnerId,
      name: data.name,
      description: data.description ?? null,
      permissions,
    });
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_POLICY_CREATED, {
      title: "权限策略已创建",
      content: `策略 "${data.name}" 已成功创建。`,
      data: { policyId: policy.id, policyName: data.name },
    });
    return this.mapPolicyToDto(policy);
  }

  async updatePolicy(actorUserId: string, policyId: string, data: UpdateRamPolicyDto): Promise<RamPolicyDto> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const policy = await this.ramPolicyRepository.findPolicyById(policyId);
    if (!policy) throw new NotFoundError("权限策略不存在", undefined, { messageKey: "ram.policyNotFound" });
    this.assertSameAccount(accountOwnerId, policy.accountOwnerId);
    if (policy.type === "managed_product_owner") throw new ForbiddenError("系统托管的产品所有者策略不可修改");

    const updateData: Record<string, unknown> = {};
    if (data.description !== undefined) updateData.description = data.description;
    if (data.permissions !== undefined)
      updateData.permissions = await this.assertCanUsePolicyPermissions(actorUserId, data.permissions);
    if (data.status !== undefined) updateData.status = data.status;

    const updated = await this.ramPolicyRepository.updatePolicy(policyId, updateData);
    return this.mapPolicyToDto(updated);
  }

  async deletePolicy(actorUserId: string, policyId: string): Promise<void> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const policy = await this.ramPolicyRepository.findPolicyById(policyId);
    if (!policy) throw new NotFoundError("权限策略不存在", undefined, { messageKey: "ram.policyNotFound" });
    this.assertSameAccount(accountOwnerId, policy.accountOwnerId);
    if (policy.type === "managed_product_owner") throw new ForbiddenError("系统托管的产品所有者策略不可删除");
    await this.ramPolicyRepository.softDeletePolicy(policyId);
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_POLICY_DELETED, {
      title: "权限策略已删除",
      content: `策略 "${policy.name}" 已被删除。`,
      data: { policyId, policyName: policy.name },
    });
  }

  async attachPolicy(actorUserId: string, data: AttachPolicyBodyDto): Promise<void> {
    const { accountOwnerId, policy } = await this.assertPolicyAttachmentScope(actorUserId, data);
    if (policy.type === "managed_product_owner") throw new ForbiddenError("系统托管的产品所有者策略不可重新绑定");
    await this.assertCanUsePolicyPermissions(actorUserId, normalizeJsonStringArray(policy.permissions));

    await this.ramPolicyRepository.attachPolicy(accountOwnerId, data.policyId, data.targetType, data.targetId);
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_POLICY_ATTACHED, {
      title: "权限策略已绑定",
      content: `权限策略 "${policy.name}" 已成功绑定。`,
      data: { policyId: data.policyId, targetType: data.targetType, targetId: data.targetId },
    });
  }

  async detachPolicy(actorUserId: string, data: AttachPolicyBodyDto): Promise<void> {
    const { policy } = await this.assertPolicyAttachmentScope(actorUserId, data);
    if (policy.type === "managed_product_owner") throw new ForbiddenError("系统托管的产品所有者策略不可解绑");

    await this.ramPolicyRepository.detachPolicy(data.policyId, data.targetType, data.targetId);
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_POLICY_DETACHED, {
      title: "权限策略已解绑",
      content: `权限策略 "${policy.name}" 已成功解绑。`,
      data: { policyId: data.policyId, targetType: data.targetType, targetId: data.targetId },
    });
  }

  async listPolicyAttachments(actorUserId: string, policyId: string): Promise<RamPolicyAttachmentDto[]> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const policy = await this.ramPolicyRepository.findPolicyById(policyId);
    if (!policy) throw new NotFoundError("权限策略不存在", undefined, { messageKey: "ram.policyNotFound" });
    this.assertSameAccount(accountOwnerId, policy.accountOwnerId);

    const attachments = await this.ramPolicyRepository.listAttachmentsByPolicy(policyId);
    return attachments.map((a) => ({
      id: a.id,
      accountOwnerId,
      policyId: a.policyId,
      policyName: a.policyName,
      targetType: a.targetType,
      targetId: a.targetId,
      targetName: a.targetName ?? undefined,
      createTime: a.createTime.toISOString(),
    }));
  }

  // ── 授权概览 ──

  async getUserEffectivePermissions(actorUserId: string, targetUserId: string): Promise<EffectivePermissionDto> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const user = await this.userRepository.findById(targetUserId);
    if (!user) throw new NotFoundError("用户不存在", undefined, { messageKey: "ram.userNotFound" });
    this.assertSameAccount(accountOwnerId, user.accountOwnerId || user.parentUserId || user.id);

    // 1. 用户直接权限
    const directPermissions = normalizeJsonStringArray(user.permissionAdds);

    // 2. 用户所属组的权限
    let groupPermissions: string[] = [];
    if (user.groupId) {
      const group = await this.groupRepository.findById(user.groupId);
      if (group && group.status === AccountStatus.ACTIVE)
        groupPermissions = normalizeJsonStringArray(group.permissions);
    }

    // 3. 通过角色绑定的权限
    const roleBindings = await this.ramRoleRepository.listRoleBindingsForUser(user.id, user.groupId);
    const rolePermissions = [...new Set(roleBindings.flatMap((b) => b.permissions))];

    // 4. 通过权限策略绑定的权限
    const policyBindings = await this.ramPolicyRepository.listPoliciesForTarget("user", user.id);
    let policyPermissions: string[] = [...new Set(policyBindings.flatMap((b) => b.permissions))];

    // 如果用户有所属组，追加组上绑定的策略权限
    if (user.groupId) {
      const groupPolicyBindings = await this.ramPolicyRepository.listPoliciesForTarget("group", user.groupId);
      policyPermissions = [...new Set([...policyPermissions, ...groupPolicyBindings.flatMap((b) => b.permissions)])];
    }

    // 5. 用户的排除权限
    const permissionRemoves = normalizeJsonStringArray(user.permissionRemoves);

    // 合并去重
    const allPerms = new Set([...directPermissions, ...groupPermissions, ...rolePermissions, ...policyPermissions]);
    const removeSet = new Set(permissionRemoves);
    const effectivePermissions = [...allPerms].filter((p) => !removeSet.has(p));

    return {
      userId: user.id,
      username: user.username,
      ramUsername: user.ramUsername ?? user.username,
      directPermissions,
      groupPermissions,
      rolePermissions,
      policyPermissions,
      permissionRemoves,
      effectivePermissions,
    };
  }
}

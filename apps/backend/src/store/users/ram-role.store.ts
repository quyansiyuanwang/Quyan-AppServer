import type { IamManagementPageResult } from "@quyan/shared";
import type { IamManagementPage, IamManagementSearchPage } from "@/iam/management-pagination";
import type { RamRole, RamRoleSession, Prisma } from "@prisma/client";

export type RamRoleWithBindings = Prisma.RamRoleGetPayload<{
  include: {
    userBindings: true;
    groupBindings: true;
  };
}>;

export type ActiveRamRoleSession = RamRoleSession & { role: RamRole };

export interface CreateRamRoleInput {
  accountOwnerId: string;
  name: string;
  description?: string | null;
  trustPolicy?: Record<string, unknown> | null;
  maxSessionDuration?: number;
}

export interface UpdateRamRoleInput {
  expectedUpdateTime?: Date;
  description?: string | null;
  trustPolicy?: Record<string, unknown> | null;
  maxSessionDuration?: number;
  status?: number;
}

export interface RamRoleBindingRecord {
  id: string;
  roleId: string;
  roleName: string;
  permissions: string[];
  source: "user" | "group";
  principalId: string;
}

export interface RamRoleStore {
  createRole(data: CreateRamRoleInput): Promise<RamRole>;
  findRoleById(roleId: string): Promise<RamRole | null>;
  findRoleByName(accountOwnerId: string, name: string): Promise<RamRole | null>;
  listRoles(accountOwnerId: string): Promise<RamRole[]>;
  listRolesPage(accountOwnerId: string, pagination: IamManagementSearchPage): Promise<IamManagementPageResult<RamRole>>;
  updateRole(roleId: string, data: UpdateRamRoleInput): Promise<RamRole>;
  softDeleteRole(roleId: string): Promise<RamRole>;
  bindRoleToUser(accountOwnerId: string, roleId: string, userId: string): Promise<void>;
  unbindRoleFromUser(roleId: string, userId: string): Promise<void>;
  bindRoleToGroup(accountOwnerId: string, roleId: string, groupId: string): Promise<void>;
  unbindRoleFromGroup(roleId: string, groupId: string): Promise<void>;
  /** Explicit target namespace is available only for internal group projections with an empty user ID. */
  listRoleBindingsForUser(
    userId: string,
    groupId?: string | null,
    projection?: { groupAccountOwnerId: string },
  ): Promise<RamRoleBindingRecord[]>;
  listRoleBindingsByRole(roleId: string): Promise<RamRoleWithBindings | null>;
  listRoleBindingPage(
    accountOwnerId: string,
    roleId: string,
    pagination: IamManagementPage,
    target?: { userId: string; groupId?: string | null },
  ): Promise<IamManagementPageResult<RamRoleBindingRecord>>;
  createRoleSession(data: {
    accountOwnerId: string;
    subjectUserId: string;
    roleId: string;
    sessionName: string;
    expiresAt: Date;
    expectedRoleUpdateTime?: Date;
  }): Promise<ActiveRamRoleSession>;
  findActiveRoleSession(sessionId: string): Promise<ActiveRamRoleSession | null>;
  revokeRoleSession(sessionId: string): Promise<RamRoleSession>;
  listActiveRoleSessions(accountOwnerId: string, subjectUserId?: string): Promise<ActiveRamRoleSession[]>;
  listActiveRoleSessionsPage(
    accountOwnerId: string,
    pagination: IamManagementPage,
    subjectUserId?: string,
  ): Promise<IamManagementPageResult<ActiveRamRoleSession>>;
}

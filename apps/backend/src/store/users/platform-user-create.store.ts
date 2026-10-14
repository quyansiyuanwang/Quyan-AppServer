import type { IamPrincipal, Permission } from "@quyan/shared";
import type { UserDto } from "@/api/dto/users/user.dto";
import type { IamAccountUserMutationGuard } from "./iam-account-user-mutation";
export interface PlatformUserCreateGroup {
  id: string;
  username: string;
  level: number;
  updateTime: Date;
  permissions: Permission[];
  recoveryBootstrap: boolean;
}
export interface PlatformUserCreateData {
  username: string;
  password: string;
  email?: string;
  name?: string;
  groupId?: string;
}
export interface PlatformUserCreateGuard {
  data: PlatformUserCreateData;
  destination: PlatformUserCreateGroup;
  group: { id: string; updateTime: Date };
  authorizationRevision: string;
  users: IamAccountUserMutationGuard;
  /** Evaluate generated real identity before commit. Never expose the credential to authorization callbacks. */
  authorizeCreated(id: string): Promise<void>;
}
export interface PlatformUserCreateStore {
  destination(principal: IamPrincipal, id?: string): Promise<PlatformUserCreateGroup>;
  authorizationRevision(principal: IamPrincipal): Promise<string>;
  recheck(principal: IamPrincipal, expected: PlatformUserCreateGroup, id?: string): Promise<void>;
  created(
    principal: IamPrincipal,
    id: string,
    data: PlatformUserCreateData,
    destination: PlatformUserCreateGroup,
  ): Promise<() => Promise<void>>;
  create(guard: PlatformUserCreateGuard): Promise<UserDto>;
}

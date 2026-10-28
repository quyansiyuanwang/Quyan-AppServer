import type { IamPrincipal } from "@quyan/shared";
import type { UserDto, UpdateUserDto } from "@/api/dto/users/user.dto";
import type { IamAccountUserMutationGuard } from "./iam-account-user-mutation";
import type { PlatformUserReadTarget } from "./platform-user-read.store";
export interface PlatformUserUpdateGroup {
  id: string;
  accountOwnerId: string | null;
  level: number;
  updateTime: Date;
}
export interface PlatformUserUpdateTarget {
  resource: PlatformUserReadTarget;
  accountOwnerId: string;
  group: PlatformUserUpdateGroup;
  actorLevel: number;
  recoveryBootstrap: boolean;
  email: string | null;
}
export interface PlatformUserUpdateGuard {
  target: PlatformUserUpdateTarget;
  destination?: PlatformUserUpdateGroup;
  data: UpdateUserDto;
  group: { id: string; updateTime: Date };
  authorizationRevision: string;
  users: IamAccountUserMutationGuard;
}
export interface PlatformUserUpdateResult {
  user: UserDto;
  previousStatus: number;
}
export interface PlatformUserUpdateStore {
  target(principal: IamPrincipal, id: string): Promise<PlatformUserUpdateTarget>;
  destination(principal: IamPrincipal, target: PlatformUserUpdateTarget, id: string): Promise<PlatformUserUpdateGroup>;
  authorizationRevision(principal: IamPrincipal, targetAccountOwnerId: string): Promise<string>;
  recheck(
    principal: IamPrincipal,
    target: PlatformUserUpdateTarget,
    destination?: PlatformUserUpdateGroup,
  ): Promise<void>;
  update(guard: PlatformUserUpdateGuard): Promise<PlatformUserUpdateResult>;
}

import type { IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "./iam-account-user-mutation";
import type { PlatformUserReadTarget } from "./platform-user-read.store";
export interface PlatformUserDeleteTarget {
  resource: PlatformUserReadTarget;
  username: string;
  groupId: string;
  actorLevel: number;
  targetLevel: number;
}
export interface PlatformUserDeleteGuard {
  action: "quyan:user:DeleteUser";
  target: PlatformUserDeleteTarget;
  group: { id: string; updateTime: Date };
  authorizationRevision: string;
  users: IamAccountUserMutationGuard;
}
export interface PlatformUserDeleteStore {
  target(principal: IamPrincipal, id: string): Promise<PlatformUserDeleteTarget>;
  authorizationRevision(principal: IamPrincipal): Promise<string>;
  recheck(principal: IamPrincipal, expected: PlatformUserDeleteTarget): Promise<void>;
  remove(guard: PlatformUserDeleteGuard): Promise<{ id: string; username: string }>;
}

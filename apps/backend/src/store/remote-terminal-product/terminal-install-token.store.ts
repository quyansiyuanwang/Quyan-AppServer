import type { IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
export interface TerminalInstallTarget {
  id: string;
  userId: string;
  status: number;
  deviceLimit: number;
  updateTime: Date;
}
export interface TerminalInstallGuard {
  targetId: string;
  users: IamAccountUserMutationGuard;
}
export interface TerminalInstallTokenStore {
  target(principal: IamPrincipal, id: string): Promise<TerminalInstallTarget | null>;
  issue<T>(target: TerminalInstallTarget, guard: TerminalInstallGuard, generate: () => T | Promise<T>): Promise<T>;
}

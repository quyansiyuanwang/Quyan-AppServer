import type { IamPrincipal, IamTerminalPersonalUnbindOperation } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import type { RemoteTerminalUnbindConfig } from "@/services/system/config.service";
export interface TerminalPersonalUnbindTarget {
  id: string;
  userId: string;
  entitlementId: string;
  label: string;
  status: number;
  updateTime: Date;
  unbindResetAt: Date | null;
  entitlementUpdateTime: Date;
  entitlementStatus: number;
  revision: string;
}
export interface TerminalPersonalUnbindGuard {
  operation: IamTerminalPersonalUnbindOperation;
  users: IamAccountUserMutationGuard;
  targetId: string;
  entitlementId: string;
  config: RemoteTerminalUnbindConfig;
}
export interface TerminalPersonalUnbindStore {
  target(principal: IamPrincipal, id: string): Promise<TerminalPersonalUnbindTarget | null>;
  run(
    target: TerminalPersonalUnbindTarget,
    guard: TerminalPersonalUnbindGuard,
    mutate: boolean,
  ): Promise<{ revokedCount: number; windowStartAt: Date }>;
}

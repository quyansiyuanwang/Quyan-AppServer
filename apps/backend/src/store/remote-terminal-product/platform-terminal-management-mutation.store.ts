import type { IamPrincipal, IamTerminalManagementMutation } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
export type TerminalManagementKind = "binding" | "entitlement";
/** No token, heartbeat secret, snapshot, pricing or unrelated relation is loaded. */
export interface TerminalManagementTarget {
  kind: TerminalManagementKind;
  id: string;
  userId: string;
  status: number;
  updateTime: Date;
  label: string;
  entitlementId?: string;
  online?: boolean;
  unbindResetAt?: Date | null;
  revision: string;
}
export interface TerminalManagementMutationGuard {
  operation: IamTerminalManagementMutation;
  targetId: string;
  targetUserId: string;
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
}
export interface PlatformTerminalManagementMutationStore {
  owner(principal: IamPrincipal, operation: IamTerminalManagementMutation, id: string): Promise<string | undefined>;
  target(
    principal: IamPrincipal,
    operation: IamTerminalManagementMutation,
    id: string,
  ): Promise<TerminalManagementTarget | null>;
  mutate(target: TerminalManagementTarget, guard: TerminalManagementMutationGuard): Promise<void>;
}

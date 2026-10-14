import type { RemoteTerminalEntitlementToken } from "@prisma/client";
import type { IamPrincipal, IamTerminalRegistrationRotation } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
export interface TerminalRegistrationRotationTarget {
  id: string;
  userId: string;
  name: string;
  status: number;
  deviceLimit: number;
  updateTime: Date;
  registrationToken: Omit<RemoteTerminalEntitlementToken, "token"> | null;
  revision: string;
}
export interface TerminalRegistrationRotationGuard {
  operation: IamTerminalRegistrationRotation;
  targetId: string;
  targetUserId: string;
  users: IamAccountUserMutationGuard;
  group?: { id: string; updateTime: Date };
  recheckToken: (tokenId: string) => Promise<void>;
}
export interface TerminalRegistrationRotationInput {
  token: string;
  label: string | null;
  expiresAt: Date | null;
}
export interface TerminalRegistrationRotationStore {
  owner(principal: IamPrincipal, operation: IamTerminalRegistrationRotation, id: string): Promise<string | undefined>;
  target(
    principal: IamPrincipal,
    operation: IamTerminalRegistrationRotation,
    id: string,
  ): Promise<TerminalRegistrationRotationTarget | null>;
  rotate(
    target: TerminalRegistrationRotationTarget,
    data: TerminalRegistrationRotationInput,
    guard: TerminalRegistrationRotationGuard,
  ): Promise<RemoteTerminalEntitlementToken>;
}

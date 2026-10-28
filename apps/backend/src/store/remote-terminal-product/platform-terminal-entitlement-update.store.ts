import type { Prisma, RemoteTerminalUserEntitlement } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
export interface TerminalEntitlementUpdateTarget {
  record: RemoteTerminalUserEntitlement;
  deviceIds: string[];
  user: { id: string; status: number; accountOwnerId: string | null; updateTime: Date };
  revision: string;
}
export interface TerminalEntitlementUpdateGuard {
  operation: "UpdateEntitlement";
  targetId: string;
  targetUserId: string;
  deleteViaUpdate: boolean;
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
}
export interface PlatformTerminalEntitlementUpdateStore {
  target(principal: IamPrincipal, id: string): Promise<TerminalEntitlementUpdateTarget | null>;
  update(
    target: TerminalEntitlementUpdateTarget,
    data: Prisma.RemoteTerminalUserEntitlementUncheckedUpdateInput,
    guard: TerminalEntitlementUpdateGuard,
  ): Promise<RemoteTerminalUserEntitlement>;
}

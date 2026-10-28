import type { Prisma, RemoteTerminalProductTemplate, RemoteTerminalUserEntitlement } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
export interface TerminalAssignmentUser {
  id: string;
  status: number;
  accountOwnerId: string | null;
  updateTime: Date;
}
export interface TerminalEntitlementAssignGuard {
  operation: "AssignEntitlement";
  customer: TerminalAssignmentUser;
  template: RemoteTerminalProductTemplate | null;
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
  recheckEntry: (id: string) => Promise<void>;
}
export interface PlatformTerminalEntitlementAssignStore {
  user(principal: IamPrincipal, id: string): Promise<TerminalAssignmentUser | null>;
  template(principal: IamPrincipal, id: string): Promise<RemoteTerminalProductTemplate | null>;
  create(
    data: Prisma.RemoteTerminalUserEntitlementUncheckedCreateInput,
    guard: TerminalEntitlementAssignGuard,
  ): Promise<RemoteTerminalUserEntitlement>;
}

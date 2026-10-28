import type { IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
export interface TicketAssignmentTarget {
  id: string;
  status: number;
  createTime: Date;
  updateTime: Date;
  revision: string;
}
export interface TicketAssignmentWriteGuard {
  users: IamAccountUserMutationGuard;
  group: { id: string; updateTime: Date };
  authorizationRevision: string;
}
export interface PlatformTicketAssignmentStore {
  target(principal: IamPrincipal): Promise<TicketAssignmentTarget | null>;
  hydrate(principal: IamPrincipal, target: TicketAssignmentTarget | null): Promise<string | null>;
  authorizationRevision(principal: IamPrincipal): Promise<string>;
  update(value: string, target: TicketAssignmentTarget | null, guard: TicketAssignmentWriteGuard): Promise<void>;
}

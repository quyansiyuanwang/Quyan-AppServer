import type { Prisma, RemoteTerminalProductTemplate, RemoteTerminalUserEntitlement } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
export interface TerminalPurchaseGuard {
  template: RemoteTerminalProductTemplate;
  target: RemoteTerminalUserEntitlement | null;
  users: IamAccountUserMutationGuard;
  recheckEntry: (id: string) => Promise<void>;
}
export type TerminalPurchaseData =
  | { kind: "create"; entitlement: Prisma.RemoteTerminalUserEntitlementUncheckedCreateInput; chargeAmount: number }
  | { kind: "renew"; entitlement: Prisma.RemoteTerminalUserEntitlementUncheckedUpdateInput; chargeAmount: number };
export interface TerminalPurchaseStore {
  template(principal: IamPrincipal, id: string): Promise<RemoteTerminalProductTemplate | null>;
  target(principal: IamPrincipal, id: string): Promise<RemoteTerminalUserEntitlement | null>;
  purchase(data: TerminalPurchaseData, guard: TerminalPurchaseGuard): Promise<RemoteTerminalUserEntitlement>;
}

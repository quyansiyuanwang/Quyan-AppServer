import type { Prisma, RemoteTerminalProductTemplate } from "@prisma/client";
import type { IamPrincipal, IamTerminalTemplateWriteOperation } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
export interface TerminalTemplateWriteTarget {
  record: RemoteTerminalProductTemplate;
  revision: string;
}
export interface TerminalTemplateWriteGuard {
  operation: IamTerminalTemplateWriteOperation;
  deleteViaUpdate: boolean;
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
  recheckEntry: (id: string) => Promise<void>;
}
export interface PlatformTerminalTemplateWriteStore {
  target(principal: IamPrincipal, id: string): Promise<TerminalTemplateWriteTarget | null>;
  create(
    data: Prisma.RemoteTerminalProductTemplateUncheckedCreateInput,
    guard: TerminalTemplateWriteGuard,
  ): Promise<RemoteTerminalProductTemplate>;
  mutate(
    target: TerminalTemplateWriteTarget,
    data: Prisma.RemoteTerminalProductTemplateUncheckedUpdateInput,
    guard: TerminalTemplateWriteGuard,
  ): Promise<RemoteTerminalProductTemplate>;
}

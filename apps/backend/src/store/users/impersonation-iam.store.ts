import type { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
export const IMPERSONATION_USER_SELECT = {
  id: true,
  status: true,
  username: true,
  name: true,
  updateTime: true,
  accountOwnerId: true,
  groupId: true,
  permissionAdds: true,
  permissionRemoves: true,
  group: { select: { id: true, status: true, level: true, accountOwnerId: true, permissions: true, updateTime: true } },
} as const;
export type ImpersonationUser = Prisma.UserGetPayload<{ select: typeof IMPERSONATION_USER_SELECT }>;
export interface ImpersonationSnapshot {
  actor: ImpersonationUser;
  target: ImpersonationUser;
  revision: string;
  authorizationRevision: string;
  canAct: boolean;
  canView: boolean;
}
export interface ImpersonationIamStore {
  snapshot(principal: IamPrincipal, targetId: string, accessKeyId?: string): Promise<ImpersonationSnapshot>;
  guarded(
    principal: IamPrincipal,
    targetId: string,
    expected: ImpersonationSnapshot,
    recheck: () => Promise<void>,
    accessKeyId?: string,
  ): Promise<ImpersonationSnapshot>;
}

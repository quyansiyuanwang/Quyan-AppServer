import type { IamPrincipal } from "@quyan/shared";
import type { UserOnlineSession } from "@prisma/client";
import type { OnlineUserTarget } from "./user-online-monitor.store";
export type OnlineRevocationTarget = Pick<UserOnlineSession, "id" | "userId" | "status" | "updateTime" | "endedAt">;
export interface UserOnlineRevocationStore {
  sessionTarget(principal: IamPrincipal, id: string): Promise<OnlineRevocationTarget | null>;
  userTarget(principal: IamPrincipal, id: string): Promise<OnlineUserTarget | null>;
  closeSession(
    principal: IamPrincipal,
    target: OnlineRevocationTarget,
    mark: (authSessionId: string, endedAt: Date) => Promise<void>,
  ): Promise<{ closed: boolean; authSessionId?: string }>;
  closeUser(
    principal: IamPrincipal,
    target: OnlineUserTarget,
    mark: (userId: string, endedAt: Date) => Promise<void>,
  ): Promise<number>;
}

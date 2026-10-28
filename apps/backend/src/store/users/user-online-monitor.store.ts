import type { IamPrincipal } from "@quyan/shared";
import type { UserOnlineSession } from "@prisma/client";
import type { UserOnlineMonitorDetailDto } from "@/api/dto/users/user-online-monitor.dto";
export type OnlineSessionTarget = Pick<UserOnlineSession, "id" | "userId" | "status" | "createTime" | "updateTime">;
export type OnlineSessionView = Pick<
  UserOnlineSession,
  | "id"
  | "userId"
  | "authSessionId"
  | "startedAt"
  | "lastHeartbeatAt"
  | "endedAt"
  | "durationSeconds"
  | "lastIpAddress"
  | "lastLocation"
  | "userAgent"
> & { user: { username: string; name: string | null } };
export type OnlineUserTarget = { id: string; updateTime: Date };
export interface UserOnlineMonitorStore {
  userTarget(principal: IamPrincipal, id: string): Promise<OnlineUserTarget | null>;
  scan(principal: IamPrincipal, userId?: string, after?: OnlineSessionTarget): Promise<OnlineSessionTarget[]>;
  hydrate(principal: IamPrincipal, targets: OnlineSessionTarget[]): Promise<OnlineSessionView[]>;
  detail(principal: IamPrincipal, target: OnlineUserTarget, cutoff: Date): Promise<UserOnlineMonitorDetailDto | null>;
}

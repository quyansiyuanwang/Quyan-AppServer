import { UserOnlineRevocationRepository } from "@/store/users/user-online-revocation.repository";
import type { ResourceResolver } from "./resource-resolvers";
import { isCanonicalOnlineId, onlineUserArn, onlineSessionArn } from "../resources/online-session-resources";
import { UserOnlineMonitorRepository } from "@/store/users/user-online-monitor.repository";
export const onlineUserResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const id = request.params.userId;
  if (!isCanonicalOnlineId(id)) return undefined;
  const target = await UserOnlineMonitorRepository.getInstance().userTarget(principal, id);
  return target?.id === id ? onlineUserArn(principal.accountOwnerId, id) : undefined;
};

export const onlineSessionResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const id = request.params.sessionId;
  if (!isCanonicalOnlineId(id)) return undefined;
  const target = await UserOnlineRevocationRepository.getInstance().sessionTarget(principal, id);
  return target?.id === id ? onlineSessionArn(principal.accountOwnerId, target.userId, id) : undefined;
};

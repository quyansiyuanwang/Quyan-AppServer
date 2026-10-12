import type { ResourceResolver } from "./resource-resolvers";
import { isCanonicalOnlineId, onlineUserArn } from "../resources/online-session-resources";
import { UserOnlineMonitorRepository } from "@/store/users/user-online-monitor.repository";
export const onlineUserResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const id = request.params.userId;
  if (!isCanonicalOnlineId(id)) return undefined;
  const target = await UserOnlineMonitorRepository.getInstance().userTarget(principal, id);
  return target?.id === id ? onlineUserArn(principal.accountOwnerId, id) : undefined;
};

import { RemoteTerminalDeviceReadRepository } from "@/store/remote-terminal-product/remote-terminal-device-read.repository";
import { isRemoteTerminalId, remoteTerminalDeviceArn } from "../resources/remote-terminal-resources";
import type { ResourceResolver } from "./resource-resolvers";
export const remoteTerminalQueryDeviceResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const deviceId = request.query.deviceId;
  if (!isRemoteTerminalId(deviceId)) return undefined;
  const targets = await RemoteTerminalDeviceReadRepository.getInstance().targets(principal, [deviceId]);
  const target = targets[0];
  if (targets.length !== 1 || !target || target.deviceId !== deviceId || target.userId !== principal.subjectUserId)
    return undefined;
  return remoteTerminalDeviceArn(principal.accountOwnerId, target.userId, target.deviceId);
};

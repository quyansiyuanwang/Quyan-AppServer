import { RemoteTerminalDeviceReadRepository } from "@/store/remote-terminal-product/remote-terminal-device-read.repository";
import { isRemoteTerminalId, remoteTerminalDeviceArn } from "../resources/remote-terminal-resources";
import type { ResourceResolver, ResourceResolverContext } from "./resource-resolvers";
async function resolveDevice(deviceId: unknown, { principal }: ResourceResolverContext) {
  if (!isRemoteTerminalId(deviceId)) return undefined;
  const targets = await RemoteTerminalDeviceReadRepository.getInstance().targets(principal, [deviceId]);
  const target = targets[0];
  if (targets.length !== 1 || !target || target.deviceId !== deviceId || target.userId !== principal.subjectUserId)
    return undefined;
  return remoteTerminalDeviceArn(principal.accountOwnerId, target.userId, target.deviceId);
}
export const remoteTerminalQueryDeviceResourceResolver: ResourceResolver = (context) =>
  resolveDevice(context.request.query.deviceId, context);
export const remoteTerminalBodyDeviceResourceResolver: ResourceResolver = (context) =>
  resolveDevice((context.request.body as { deviceId?: unknown } | undefined)?.deviceId, context);

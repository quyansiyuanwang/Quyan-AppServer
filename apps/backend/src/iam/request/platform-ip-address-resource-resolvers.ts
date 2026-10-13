import { platformIpAddressArn, platformIpAddressIdentifier } from "../resources/platform-ip-address-resources";
import type { ResourceResolver } from "./resource-resolvers";
export const platformIpAddressResourceResolver: ResourceResolver = ({ request }) => {
  const ip = request.params.ip;
  return platformIpAddressIdentifier(ip) ? platformIpAddressArn(ip as string) : undefined;
};

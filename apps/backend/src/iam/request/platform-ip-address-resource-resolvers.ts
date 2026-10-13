import { platformIpAddressArn, platformIpAddressIdentifier } from "../resources/platform-ip-address-resources";
import type { ResourceResolver } from "./resource-resolvers";
export const platformIpAddressResourceResolver: ResourceResolver = ({ request }) => {
  const ip = request.params.ip;
  return platformIpAddressIdentifier(ip) ? platformIpAddressArn(ip as string) : undefined;
};

/** ID routes resolve the address from qualified server metadata, never from a submitted ARN or account. */
export const platformIpBlacklistRecordResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const { platformManagementGroupSnapshot } = await import("@/store/users/platform-management-principal");
  const { PlatformIPBlacklistRecordReadRepository } = await import(
    "@/store/security/platform-ip-blacklist-record-read.repository"
  );
  const { Permission } = await import("@quyan/shared");
  const { isPlatformLogResourceId } = await import("../resources/platform-log-resources");
  const id = request.params.id;
  if (typeof id !== "string" || !isPlatformLogResourceId(id)) return undefined;
  await platformManagementGroupSnapshot(principal, Permission.IP_BLACKLIST_READ);
  const target = await PlatformIPBlacklistRecordReadRepository.getInstance().target(id);
  return target && platformIpAddressIdentifier(target.ipAddress) ? platformIpAddressArn(target.ipAddress) : undefined;
};

/** IP-address mutation paths resolve only the validated address, never an ARN from the client. */
export const platformIpBlacklistMutationResourceResolver: ResourceResolver = ({ request }) => {
  const ip = request.params.ipAddress;
  return platformIpAddressIdentifier(ip) ? platformIpAddressArn(ip as string) : undefined;
};

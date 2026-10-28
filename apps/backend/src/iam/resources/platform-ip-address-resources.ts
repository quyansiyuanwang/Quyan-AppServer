import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
import { canonicalIpAddressIdentifier as platformIpAddressIdentifier } from "@/util/ip-address-identity";
export { canonicalIpAddressIdentifier as platformIpAddressIdentifier } from "@/util/ip-address-identity";
export function platformIpAddressArn(ip: string): string {
  const identifier = platformIpAddressIdentifier(ip);
  if (!identifier) throw new Error("Invalid IP address resource");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "ip-address/" + identifier,
  });
}

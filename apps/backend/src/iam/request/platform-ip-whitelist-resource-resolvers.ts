import type { ResourceResolver } from "./resource-resolvers";
import { ipWhitelistIpParamsSchema } from "@/api/schema/system/ipwhitelist.schema";
import { PlatformIpWhitelistReadRepository } from "@/store/security/platform-ip-whitelist-read.repository";
import { platformIpWhitelistArn } from "../resources/platform-ip-whitelist-resources";
/** Lookup only metadata; the address selects a real record and never becomes an ARN segment. */
export const platformIpWhitelistStatusResource: ResourceResolver = async ({ request, principal }) => {
  const parsed = ipWhitelistIpParamsSchema.safeParse(request.params);
  if (!parsed.success) return undefined;
  const target = await PlatformIpWhitelistReadRepository.getInstance().target(principal, parsed.data.ip);
  return target ? platformIpWhitelistArn(target.id) : undefined;
};

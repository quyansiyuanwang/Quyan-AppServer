import {
  batchRelayChannelUpstreamModelsBodySchema,
  applyRelayChannelModelRestrictionsBodySchema,
} from "@/api/schema/relay/relay-channel.schema";
import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
import { isPlatformLogResourceId } from "./platform-log-resources";
/** Global relay channels are deployment resources, independent of an account's identity ARN. */
export function platformRelayChannelArn(id: string) {
  if (!isPlatformLogResourceId(id)) throw new Error("Invalid platform relay channel identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "relay-channel/" + id,
  });
}

/** Global channel IDs never inherit an account supplied by the caller. */
export const platformRelayChannelResourceResolver: import("../request/resource-resolvers").ResourceResolver = ({
  request,
}) => {
  const id = request.params.id;
  return isPlatformLogResourceId(id) ? platformRelayChannelArn(id) : undefined;
};

/** A deployment-level revenue relation; never authority over the recipient's IAM identity. */
export function platformRelayChannelProviderArn(channelId: string, providerUserId: string) {
  if (![channelId, providerUserId].every(isPlatformLogResourceId))
    throw new Error("Invalid platform channel provider identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "relay-channel-provider/" + channelId + "/" + providerUserId,
  });
}

/** Every target is validated from the canonical schema; account hints cannot change platform scope. */
export const platformRelayChannelModelRestrictionResources: import("../request/resource-resolvers").BatchResourceResolver =
  ({ request }) => {
    const parsed = applyRelayChannelModelRestrictionsBodySchema.safeParse(request.body);
    if (!parsed.success || parsed.data.targets.some((target) => !isPlatformLogResourceId(target.channelId)))
      return undefined;
    return parsed.data.targets.map((target) => platformRelayChannelArn(target.channelId));
  };

/** Resolve the complete caller-ordered batch without loading channel configuration or credentials. */
export const platformRelayChannelUpstreamModelResources: import("../request/resource-resolvers").BatchResourceResolver =
  ({ request }) => {
    const parsed = batchRelayChannelUpstreamModelsBodySchema.safeParse(request.body);
    if (!parsed.success || parsed.data.ids.some((id) => !isPlatformLogResourceId(id))) return undefined;
    return parsed.data.ids.map(platformRelayChannelArn);
  };

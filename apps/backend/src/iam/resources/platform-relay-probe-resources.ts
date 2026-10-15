import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
import { isPlatformLogResourceId } from "./platform-log-resources";
export function platformRelayProbeAccountArn(id: string) {
  if (!isPlatformLogResourceId(id)) throw new Error("Invalid platform probe account identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "relay-probe-account/" + id,
  });
}
export function platformRelayProbeAccountControlArn() {
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "relay-probe-account-control/default",
  });
}
export function platformRelayProbeRunArn(channelId: string, runId: string) {
  if (!isPlatformLogResourceId(channelId) || !isPlatformLogResourceId(runId))
    throw new Error("Invalid platform probe run identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "relay-probe-run/" + channelId + "/" + runId,
  });
}

export function platformRelayProbeProfileArn(channelId: string, profileId: string) {
  if (!isPlatformLogResourceId(channelId) || !isPlatformLogResourceId(profileId))
    throw new Error("Invalid platform probe profile identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "relay-probe-profile/" + channelId + "/" + profileId,
  });
}

export function platformRelayProbeQueueSlotArn(channelId: string, memberChannelId?: string) {
  if (
    !isPlatformLogResourceId(channelId) ||
    (memberChannelId !== undefined && !isPlatformLogResourceId(memberChannelId))
  )
    throw new Error("Invalid platform probe queue slot identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "relay-probe-queue-slot/" + channelId + "/" + (memberChannelId ?? "channel"),
  });
}

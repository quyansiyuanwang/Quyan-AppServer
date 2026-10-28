import { buildAcsResource } from "@quyan/shared";
import { isRelayTokenResourceId } from "./relay-token-resources";
/** A provider submission is owned by its submitter; it is not platform management authority. */
export function relayChannelSubmissionArn(accountOwnerId: string, userId: string, channelId: string) {
  if (![accountOwnerId, userId, channelId].every(isRelayTokenResourceId))
    throw new Error("Invalid channel submission identifier");
  return buildAcsResource({
    service: "relay",
    region: "*",
    accountId: accountOwnerId,
    path: "channel-submission/" + userId + "/" + channelId,
  });
}

/** The account and submitter are trusted identity fields, never request body/query/header input. */
export const relayChannelSubmissionResourceResolver: import("../request/resource-resolvers").ResourceResolver = ({
  request,
  principal,
}) => {
  const id = request.params.id;
  if (!isRelayTokenResourceId(id)) return undefined;
  return relayChannelSubmissionArn(principal.accountOwnerId, principal.subjectUserId, id);
};

/** An account-local proposed provider relation, not authority over the referenced user's identity. */
export function relayChannelSubmissionProviderArn(
  accountOwnerId: string,
  submitterUserId: string,
  channelId: string,
  providerUserId: string,
) {
  if (![accountOwnerId, submitterUserId, channelId, providerUserId].every(isRelayTokenResourceId))
    throw new Error("Invalid submission provider identifier");
  return buildAcsResource({
    service: "relay",
    region: "*",
    accountId: accountOwnerId,
    path: "submission-provider/" + submitterUserId + "/" + channelId + "/" + providerUserId,
  });
}

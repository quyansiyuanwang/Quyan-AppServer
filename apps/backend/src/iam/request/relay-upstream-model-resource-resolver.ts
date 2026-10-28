import { buildAcsResource, getIamActionDefinition, type IamPrincipal } from "@quyan/shared";
import { relayChannelUpstreamModelsBodySchema } from "@/api/schema/relay/relay-channel.schema";
import {
  RelayChannelUpstreamModelRepository,
  type UpstreamModelScopeInput,
} from "@/store/relay/relay-channel-upstream-model.repository";
import { assertIamAccountPrincipal } from "@/store/users/iam-account-principal";
import { platformManagementGroupSnapshot } from "@/store/users/platform-management-principal";
import { relayChannelSubmissionArn } from "../resources/relay-channel-submission-resources";
import { platformRelayChannelArn } from "../resources/platform-relay-channel-resources";
import type { RelayChannelUpstreamModelsRequest } from "@/api/dto/relay/relay-channel.dto";
import type { ResourceResolver } from "./resource-resolvers";
/** Original standalone submitters always use their submission ARN, including platform administrators.
 * No fallback to another ARN after a denied decision; body credentials cannot replace a saved target.
 */
export async function resolveUpstreamModelScope(
  principal: IamPrincipal,
  data: RelayChannelUpstreamModelsRequest,
): Promise<{ resource: string; scope: UpstreamModelScopeInput }> {
  await assertIamAccountPrincipal(principal);
  if (!data.channelId)
    return {
      resource: buildAcsResource({
        service: "quyan",
        region: "*",
        accountId: principal.accountOwnerId,
        path: "account",
      }),
      scope: { kind: "preview" },
    };
  const link = await RelayChannelUpstreamModelRepository.getInstance().link(principal, data.channelId);
  if (link.channelType === "standalone" && link.submittedByUserId === principal.subjectUserId)
    return {
      resource: relayChannelSubmissionArn(principal.accountOwnerId, principal.subjectUserId, link.id),
      scope: { kind: "submission", link },
    };
  const permissions = getIamActionDefinition("quyan:relay:ListUpstreamModels")!.platformPermissions!;
  await platformManagementGroupSnapshot(principal, permissions);
  return { resource: platformRelayChannelArn(link.id), scope: { kind: "platform", permissions, link } };
}
export const relayUpstreamModelResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const parsed = relayChannelUpstreamModelsBodySchema.safeParse(request.body);
  if (!parsed.success) return undefined;
  return (await resolveUpstreamModelScope(principal, parsed.data)).resource;
};

import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import type { Prisma } from "@prisma/client";
import { formatRelayRequestFormats, type IamPrincipal } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RelayChannelConfigurationReadRepository } from "@/store/relay/relay-channel-configuration-read.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { projectRelayChannelConfiguration } from "./relay-channel-configuration-projection";
import { RelayPoolResolverService } from "./relay-pool-resolver.service";
/** Project mutation responses under the same Action and transaction, including final related-capability checks. */
export async function projectAuthorizedRelayChannelMutation(
  tx: Prisma.TransactionClient,
  input: {
    principal: IamPrincipal;
    action: string;
    /** Copying uses a distinct source capability; destination creation must not grant arbitrary source access. */
    relatedAction?: string;
    request: TypedRequest;
    id: string;
    recheck: (tx: Prisma.TransactionClient) => Promise<void>;
  },
) {
  const { principal, action, request, id, recheck } = input;
  const result = await RelayChannelConfigurationReadRepository.getInstance().read(
    principal,
    { id, includeDisabled: true },
    async (resources) => {
      const iam = IamAuthorizationService.getInstance();
      if (!input.relatedAction || input.relatedAction === action)
        return platformCollectionDecisions(iam, { principal, action, request, resources });
      const decisions = new Array<string>(resources.length),
        root = platformRelayChannelArn(id);
      for (const currentAction of [action, input.relatedAction]) {
        const indices = resources
          .map((resource, index) => ((resource === root ? action : input.relatedAction) === currentAction ? index : -1))
          .filter((index) => index >= 0);
        if (!indices.length) continue;
        const outcomes = await platformCollectionDecisions(iam, {
          principal,
          action: currentAction,
          request,
          resources: indices.map((index) => resources[index]!),
        });
        if (outcomes.length !== indices.length) throw iamAccountDenied();
        indices.forEach((index, offset) => {
          decisions[index] = outcomes[offset]!;
        });
      }
      return decisions;
    },
    () => recheck(tx),
    async ({ records, context, verify }) => {
      if (records.length !== 1 || records[0]!.source.id !== id || !verify) throw iamAccountDenied();
      const { source, presence } = records[0]!,
        value = projectRelayChannelConfiguration(source, presence),
        capabilities = await RelayPoolResolverService.getInstance().resolveChannelCapabilities(id, context);
      value.allowedModels = [...new Set(capabilities.map((row) => row.catalogModelName))].sort();
      if (["pooled", "automatic-proxy-pool"].includes(value.channelType))
        value.allowedFormats = formatRelayRequestFormats([
          ...new Set(capabilities.flatMap((row) => row.supportedRequestFormats)),
        ]);
      return { value, verify };
    },
    tx,
  );
  if (!result) throw iamAccountDenied();
  return result;
}

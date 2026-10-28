import type { RelayTokenCreationReservation } from "@/store/relay/relay-token-creation-reservation";
import { RelayPoolResolverService } from "./relay-pool-resolver.service";
import type { Prisma } from "@prisma/client";
import type { RelayCustomKeyConfig } from "@/services/system/config.service";
import type { RelayTokenAuthorityIdentity } from "@/store/relay/relay-token-authority";
import type { RelayTokenUpdateInput } from "@/store/relay/relay-token.store";
import type { RelayTokenRoutingSource } from "@/store/relay/relay-token-update-admission.repository";
import { RelayTokenUpdateAdmissionRepository } from "@/store/relay/relay-token-update-admission.repository";
import { RelayChannelSelectionRepository } from "@/store/relay/relay-channel-selection.repository";
import { relayChannelSelectionArn } from "@/iam/resources/relay-channel-selection-resources";
import { platformRelayTokenArn, relayTokenArn, isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { BadRequestError, ForbiddenError } from "@/util/errors";
import type { RelayTokenUpdatePreparation } from "./relay-token-update-preparation";

export interface RelayTokenConfigurationInvocation {
  normalizers: Omit<RelayTokenUpdatePreparation, "orderedChannels" | "automaticPool" | "customCredential">;
  customKeyConfig: () => Promise<RelayCustomKeyConfig>;
  recordCustomKeyAttempt: (userId: string) => Promise<void>;
  withGraphLock: <T>(userId: string, write: () => Promise<T>) => Promise<T>;
}
/** One proof protocol for token creation and updates. Request input cannot install callbacks. */
export class RelayTokenConfigurationAdmissionService {
  private static instance: RelayTokenConfigurationAdmissionService;
  static getInstance() {
    return (this.instance ??= new RelayTokenConfigurationAdmissionService());
  }
  constructor(
    private readonly repository = RelayTokenUpdateAdmissionRepository.getInstance(),
    private readonly selections = RelayChannelSelectionRepository.getInstance(),
    private readonly pools = RelayPoolResolverService.getInstance(),
  ) {}
  private async pool(tx: Prisma.TransactionClient, id: string) {
    const proof = await this.repository.pool(tx, id);
    return { ...proof, paths: await this.pools.resolveCapabilityLeafCandidates([id], proof.graph) };
  }
  plan(
    identity: RelayTokenAuthorityIdentity,
    id: string,
    wasCustom: boolean,
    invocation: RelayTokenConfigurationInvocation,
    requireAllow: (action: string, resources: readonly string[]) => Promise<void>,
    decide: (action: string, resources: readonly string[]) => Promise<readonly string[]>,
    reservation?: RelayTokenCreationReservation,
  ) {
    const { principal, userId, managed } = identity;
    const resource = (tokenId: string) =>
      managed ? platformRelayTokenArn(userId, tokenId) : relayTokenArn(principal.accountOwnerId, userId, tokenId);
    const verifiers: ((tx: Prisma.TransactionClient, persisted: boolean) => Promise<void>)[] = [];
    let retainAlias = true;
    return {
      retainAlias: () => retainAlias,
      preparation: (
        tx: Prisma.TransactionClient,
        persist: boolean,
      ): Pick<RelayTokenUpdatePreparation, "orderedChannels" | "automaticPool" | "customCredential"> => ({
        orderedChannels: async (channelId, configs) => {
          const channelConfigs = configs?.length
            ? [...configs]
                .sort((a, b) => a.priority - b.priority)
                .map((row, priority) => ({ channelId: row.channelId, priority }))
            : channelId
              ? [{ channelId, priority: 0 }]
              : [];
          if (
            !channelConfigs.length ||
            new Set(channelConfigs.map((row) => row.channelId)).size !== channelConfigs.length
          )
            throw iamAccountDenied();
          return { defaultChannelId: channelConfigs[0]!.channelId, channelConfigs };
        },
        automaticPool: async (poolId, blocked) => {
          if (!isRelayTokenResourceId(poolId)) throw iamAccountDenied();
          await requireAllow("quyan:relay:SelectTokenChannel", [
            relayChannelSelectionArn(principal.accountOwnerId, poolId),
          ]);
          await this.selections.snapshot(principal, [poolId], tx, "automatic");
          return this.repository.blocked(await this.pool(tx, poolId), blocked);
        },
        customCredential: async (preferred) => {
          await requireAllow(managed ? "quyan:relay:SetManagedTokenCredential" : "quyan:relay:SetTokenCredential", [
            resource(id),
          ]);
          // Changing a credential into a caller-known value must not bypass an explicit Reveal denial.
          await requireAllow(managed ? "quyan:relay:RevealManagedToken" : "quyan:relay:RevealToken", [resource(id)]);
          const eligible = await this.repository.bypassEligible(tx, identity);
          const allowFree =
            eligible &&
            (
              await decide(
                managed ? "quyan:relay:BypassManagedTokenCredentialLimits" : "quyan:relay:BypassTokenCredentialLimits",
                [resource(id)],
              )
            )[0] === "Allow";
          const scope = await this.repository.customScope(tx, identity, allowFree);
          verifiers.push(async (tx) => {
            if (
              (await this.repository.bypassEligible(tx, identity)) !== eligible ||
              JSON.stringify(await this.repository.customScope(tx, identity, allowFree)) !== JSON.stringify(scope)
            )
              throw iamAccountDenied();
          });
          if (!scope.free) {
            const config = await invocation.customKeyConfig();
            if (!config.enabled)
              throw new ForbiddenError("Custom relay credentials disabled", undefined, {
                messageKey: "relay.customKeyDisabled",
              });
            const count = await this.repository.customCount(tx, userId);
            if (!wasCustom && count + (reservation?.customAdds ?? 0) >= config.maxTokensPerUser)
              throw new BadRequestError("Custom relay credential limit reached", undefined, {
                messageKey: "relay.customKeyLimitReached",
                messageParams: { limit: config.maxTokensPerUser },
              });
            verifiers.push(async (tx, persisted) => {
              if (
                JSON.stringify(await invocation.customKeyConfig()) !== JSON.stringify(config) ||
                (await this.repository.customCount(tx, userId)) !==
                  count + (persisted ? (reservation?.customAdds ?? (!wasCustom ? 1 : 0)) : 0)
              )
                throw iamAccountDenied();
            });
            if (persist) await invocation.recordCustomKeyAttempt(userId);
          }
          const credential = await this.repository.credential(tx, preferred, reservation?.credentials);
          if (reservation) {
            if (!wasCustom) reservation.customAdds++;
            reservation.credentials.add(credential.token);
            if (credential.retainAlias) reservation.credentials.add(preferred.trim());
          }
          retainAlias = credential.retainAlias;
          return credential.token;
        },
      }),
      routing: async (tx: Prisma.TransactionClient, source: RelayTokenRoutingSource, update: RelayTokenUpdateInput) => {
        const admitSelection = async (ids: string[], selectionMode: "ordered" | "automatic") => {
          await requireAllow(
            "quyan:relay:SelectTokenChannel",
            ids.map((id) => relayChannelSelectionArn(principal.accountOwnerId, id)),
          );
          const selected = await this.selections.snapshot(principal, ids, tx, selectionMode);
          await this.selections.lock(tx, ids);
          verifiers.push(async (tx) => {
            if (
              JSON.stringify(await this.selections.snapshot(principal, ids, tx, selectionMode)) !==
              JSON.stringify(selected)
            )
              throw iamAccountDenied();
          });
        };
        const mode = update.routingMode ?? source.routingMode;
        if (mode === "composite") {
          const direct = update.memberTokenConfigs ?? source.memberTokenConfigs;
          if (direct.some((edge) => !isRelayTokenResourceId(edge.tokenId))) throw iamAccountDenied();
          if (direct.length) {
            const targets = direct.map((edge) => resource(edge.tokenId));
            await requireAllow(managed ? "quyan:relay:ReferenceManagedToken" : "quyan:relay:ReferenceToken", targets);
            await requireAllow(managed ? "quyan:relay:GetManagedToken" : "quyan:relay:GetToken", targets);
          }

          const graph = await this.repository.graph(tx, source, update);
          const refs = graph.filter((node) => node.id !== id).map((node) => resource(node.id));
          if (refs.length) {
            await requireAllow(managed ? "quyan:relay:ReferenceManagedToken" : "quyan:relay:ReferenceToken", refs);
            await requireAllow(managed ? "quyan:relay:GetManagedToken" : "quyan:relay:GetToken", refs);
          }
          verifiers.push(async (tx) => {
            if (JSON.stringify(await this.repository.graph(tx, source, update)) !== JSON.stringify(graph))
              throw iamAccountDenied();
          });
        } else {
          const ids =
            mode === "automatic-pool"
              ? [
                  update.automaticProxyPoolChannelId === undefined
                    ? source.automaticProxyPoolChannelId
                    : update.automaticProxyPoolChannelId,
                ]
              : (update.channelConfigs ?? source.channelConfigs).length
                ? (update.channelConfigs ?? source.channelConfigs).map((row) => row.channelId)
                : [update.channelId === undefined ? source.channelId : update.channelId];
          if (!ids.every(isRelayTokenResourceId)) throw iamAccountDenied();
          const selectionMode = mode === "automatic-pool" ? "automatic" : "ordered";
          await admitSelection(ids, selectionMode);
          const dormantConfigs = update.channelConfigs ?? source.channelConfigs;
          const dormantPrimary = update.channelId === undefined ? source.channelId : update.channelId;
          if (mode === "automatic-pool" && (dormantConfigs.length || dormantPrimary)) {
            // Legacy callers may retain automatic mode while patching dormant ordered bindings.
            // Every resulting reference still needs admission even if it is not the active route.
            const dormant = dormantConfigs.length ? dormantConfigs.map((row) => row.channelId) : [dormantPrimary];
            if (!dormant.every(isRelayTokenResourceId)) throw iamAccountDenied();
            await admitSelection(dormant, "ordered");
          }
          if (mode === "automatic-pool") {
            const pool = await this.pool(tx, ids[0]!);
            const blocked = update.blockedAutomaticProxyPoolChannelIds ?? source.blockedAutomaticProxyPoolChannelIds;
            if (blocked !== null && (!Array.isArray(blocked) || blocked.some((id) => typeof id !== "string")))
              throw iamAccountDenied();
            const normalized = this.repository.blocked(pool, blocked === null ? undefined : (blocked as string[]));
            if (blocked !== null && JSON.stringify(normalized) !== JSON.stringify(blocked)) throw iamAccountDenied();
            const members = pool.sources.map((row) => row.id);
            if (members.length) await this.selections.lock(tx, members);
            verifiers.push(async (tx) => {
              if (JSON.stringify((await this.repository.pool(tx, ids[0]!)).sources) !== JSON.stringify(pool.sources))
                throw iamAccountDenied();
            });
          }
        }
      },
      verify: async (tx: Prisma.TransactionClient, persisted: boolean) => {
        for (const verify of verifiers) await verify(tx, persisted);
      },
    };
  }
}

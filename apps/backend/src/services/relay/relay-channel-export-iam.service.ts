import { isDeepStrictEqual as same } from "node:util";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestTransportConditionContext } from "@/iam/request/condition-context";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { RelayChannelExportRepository } from "@/store/relay/relay-channel-export.repository";
import { PermissionService } from "../users/permission.service";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { exportRelayChannelsBodySchema } from "@/api/schema/relay/relay-channel.schema";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { ExportRelayChannelsRequest, RelayChannelExportResponse } from "@/api/dto/relay/relay-channel.dto";
const action = "quyan:relay:ExportChannels",
  permission = Permission.RELAY_CHANNEL_EXPORT;
export class RelayChannelExportIamService {
  private static instance: RelayChannelExportIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelExportIamService());
  }
  async read(
    input: ExportRelayChannelsRequest,
    actorUserId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<RelayChannelExportResponse>,
    onAuthorizedExport?: (result: RelayChannelExportResponse) => Promise<void>,
  ) {
    const parsed = exportRelayChannelsBodySchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestError("Invalid channel export request", undefined, { messageKey: "errors.badRequest" });
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const identity = getIamPrincipal(request);
    if (
      !identity ||
      identity.subjectUserId !== actorUserId ||
      identity.principalUserId !== actorUserId ||
      request.oauthAccessToken
    )
      throw iamAccountDenied();
    const principal = { ...identity };
    if (
      mode !== "enforce" &&
      !(
        await PermissionService.getInstance().checkUserPermissions(actorUserId, [permission], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const evaluate = async (hydrate: boolean) => {
      const iam = IamAuthorizationService.getInstance(),
        snapshots = PlatformManagementReadRepository.getInstance();
      const snapshot = await snapshots.snapshot(principal, permission),
        fingerprint = fingerprintIamPolicies(await iam.loadPolicies(principal));
      const keyId = request.accessKey?.id,
        keyRevision = await captureIamAccessKeyRevision(principal, keyId),
        transport = requestTransportConditionContext(request);
      const assertRequest = () => {
        if (
          env.security.iamAuthorizationMode !== mode ||
          !same(getIamPrincipal(request), principal) ||
          request.accessKey?.id !== keyId ||
          request.oauthAccessToken ||
          !same(requestTransportConditionContext(request), transport)
        )
          throw iamAccountDenied();
      };
      const recheck = async () => {
        assertRequest();
        await snapshots.recheck(principal, permission, snapshot);
        if (
          fingerprintIamPolicies(await iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId)) !== keyRevision
        )
          throw iamAccountDenied();
        assertRequest();
      };
      const observed = new Map<string, string>();
      const decide = async (resources: readonly string[]) => {
        const outcomes = await platformCollectionDecisions(iam, { principal, request, action, resources });
        resources.forEach((resource, index) => {
          const decision = outcomes[index]!;
          if (observed.has(resource) && observed.get(resource) !== decision) throw iamAccountDenied();
          observed.set(resource, decision);
        });
        return outcomes;
      };
      await recheck();
      const result = await RelayChannelExportRepository.getInstance().read(
        principal,
        parsed.data,
        decide,
        recheck,
        hydrate,
      );
      if (hydrate && result) await onAuthorizedExport?.(result);
      const entries = [...observed.keys()],
        limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
      for (let offset = 0; offset < entries.length; offset += limit)
        await decide(entries.slice(offset, offset + limit));
      await recheck();
      return result;
    };
    if (mode === "enforce") {
      const result = await evaluate(true);
      if (!result) throw iamAccountDenied();
      return result;
    }
    try {
      await evaluate(false);
    } catch {
      getLogger("RelayChannelExportIam", LogCategory.SECURITY).warn("Channel export shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}

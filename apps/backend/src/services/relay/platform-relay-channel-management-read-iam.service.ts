import { BadRequestError } from "@/util/errors";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformRelayChannelManagementReadRepository } from "@/store/relay/platform-relay-channel-management-read.repository";
import type { PlatformRelayChannelManagementReadStore } from "@/store/relay/platform-relay-channel-management-read.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { relayChannelManagementQuerySchema } from "@/api/schema/relay/relay-channel.schema";
import {
  buildRelayChannelManagementQuery,
  type RelayChannelManagementFilters,
} from "@/store/relay/relay-channel-management-query";
import { RelayPoolResolverService } from "./relay-pool-resolver.service";
import { projectRelayManagementChannels } from "./relay-channel-management-projection";
import type { Prisma } from "@prisma/client";
import type { RelayChannelManagementListItemDto } from "@/api/dto/relay/relay-channel.dto";
import type { PaginatedResponse } from "@/api/dto/common/common.dto";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
export class PlatformRelayChannelManagementReadIamService {
  private static instance: PlatformRelayChannelManagementReadIamService;
  static getInstance() {
    return (this.instance ??= new PlatformRelayChannelManagementReadIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformRelayChannelManagementReadStore = PlatformRelayChannelManagementReadRepository.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly resolver: Pick<
      RelayPoolResolverService,
      "resolveChannelCapabilities"
    > = RelayPoolResolverService.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  private async read<T>(
    operation: "ListManagementChannels",
    request: TypedRequest | undefined,
    native: (
      principal: IamPrincipal,
      decide: (resources: readonly string[]) => Promise<readonly string[]>,
      recheck: () => Promise<void>,
    ) => Promise<T>,
    legacy: () => Promise<T>,
  ) {
    const mode = env.security.iamAuthorizationMode,
      action = "quyan:relay:" + operation;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const principal = getIamPrincipal(request);
    if (!principal || request.oauthAccessToken || principal.subjectUserId !== principal.principalUserId)
      throw iamAccountDenied();
    if (
      mode !== "enforce" &&
      !(
        await Promise.all(
          [Permission.RELAY_CHANNEL_READ, Permission.RELAY_CHANNEL_REVIEW].map((permission) =>
            this.permissions.checkUserPermissions(principal.subjectUserId, [permission], {
              assumedRoleSessionId: principal.roleSessionId,
            }),
          ),
        )
      ).some((result) => result.hasPermission)
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const evaluate = async () => {
      const snapshot = await this.snapshots.snapshot(principal, [
          Permission.RELAY_CHANNEL_READ,
          Permission.RELAY_CHANNEL_REVIEW,
        ]),
        policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const recheck = async () => {
        await this.snapshots.recheck(
          principal,
          [Permission.RELAY_CHANNEL_READ, Permission.RELAY_CHANNEL_REVIEW],
          snapshot,
        );
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
      };
      await recheck();
      const result = await native(
        principal,
        (resources) => platformCollectionDecisions(this.iam, { principal, action, request, resources }),
        recheck,
      );
      await recheck();
      return result;
    };
    if (mode === "enforce") return evaluate();
    try {
      await evaluate();
    } catch {
      getLogger("RelayChannelManagementReadIam", LogCategory.SECURITY).warn(
        "Relay channel management shadow evaluation failed",
        {
          action,
          reason: "iam-evaluation-denied-or-unavailable",
        },
      );
    }
    return legacy();
  }
  async list(
    actorUserId: string,
    request: TypedRequest | undefined,
    query: RelayChannelManagementFilters,
    visibility: () => Promise<Prisma.RelayChannelWhereInput | undefined>,
    legacy: () => Promise<PaginatedResponse<RelayChannelManagementListItemDto>>,
  ) {
    if (request && getIamPrincipal(request)?.subjectUserId !== actorUserId) throw iamAccountDenied();
    if (!relayChannelManagementQuerySchema.safeParse(query).success)
      throw new BadRequestError("Invalid channel management query", undefined, { messageKey: "errors.badRequest" });
    return this.read(
      "ListManagementChannels",
      request,
      async (principal, decide, recheck) => {
        const prepared = buildRelayChannelManagementQuery(query, await visibility()),
          result = await this.repository.list(principal, prepared, decide, recheck, async (id, context) => {
            const models = new Set(
              (await this.resolver.resolveChannelCapabilities(id, context)).map(
                (capability) => capability.catalogModelName,
              ),
            );
            return prepared.modelMatchMode === "all"
              ? prepared.modelFilters.every((model) => models.has(model))
              : prepared.modelFilters.some((model) => models.has(model));
          });
        return projectRelayManagementChannels(result.records, result.total, prepared.page, prepared.pageSize);
      },
      legacy,
    );
  }
}

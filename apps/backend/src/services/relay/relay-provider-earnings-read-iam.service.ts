import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { createIamPersonalReadRecheck } from "@/iam/collection/personal-collection.service";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { IamAccountUserRepository, iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import {
  RelayProviderEarningsReadRepository,
  type RelayProviderEarningsReadStore,
} from "@/store/relay/relay-provider-earnings-read.repository";
import type { RelayChannelProviderEarningsResponse } from "@/api/dto/relay/relay-channel.dto";
import type { TypedRequest } from "@/types/express";
import { getLogger, LogCategory } from "@/util/logger";
const action = "quyan:relay:ListMyProviderEarnings";
export class RelayProviderEarningsReadIamService {
  private static instance: RelayProviderEarningsReadIamService;
  static getInstance() {
    return (this.instance ??= new RelayProviderEarningsReadIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: RelayProviderEarningsReadStore = RelayProviderEarningsReadRepository.getInstance(),
    private readonly users: Pick<IamAccountUserRepository, "targets"> = IamAccountUserRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  async list(
    userId: string,
    request: TypedRequest | undefined,
    pagination: { page: number; pageSize: number },
    legacy: () => Promise<RelayChannelProviderEarningsResponse>,
  ): Promise<RelayChannelProviderEarningsResponse> {
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    if (
      !Number.isSafeInteger(pagination.page) ||
      pagination.page < 1 ||
      !Number.isSafeInteger(pagination.pageSize) ||
      pagination.pageSize < 1 ||
      pagination.pageSize > 100 ||
      !Number.isSafeInteger(pagination.page * pagination.pageSize)
    )
      throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const principal = getIamPrincipal(request);
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== userId ||
      principal.principalUserId !== userId
    )
      throw iamAccountDenied();
    if (
      mode !== "enforce" &&
      !(
        await this.permissions.checkUserPermissions(userId, [Permission.RELAY_CHANNEL_PROVIDER_READ], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const native = async () => {
      const recheck = await createIamPersonalReadRecheck(principal, this.iam, this.users);
      await recheck();
      const result = await this.repository.list(
        principal,
        pagination,
        (resources) => platformCollectionDecisions(this.iam, { principal, action, request, resources }),
        recheck,
      );
      if (
        !Number.isSafeInteger(result.total) ||
        result.total < 0 ||
        !Array.isArray(result.records) ||
        result.records.length > pagination.pageSize ||
        result.records.some((row) => row.provider.userId !== userId)
      )
        throw iamAccountDenied();
      await recheck();
      return {
        ...pagination,
        total: result.total,
        pendingAmount: Number(result.pendingAmount),
        settledAmount: Number(result.settledAmount),
        records: result.records.map((earning) => ({
          id: earning.id,
          channelId: earning.provider.relayChannel.id,
          channelName: earning.provider.relayChannel.name,
          grossAmount: Number(earning.grossAmount),
          commissionPercent: Number(earning.commissionPercent),
          commissionAmount: Number(earning.commissionAmount),
          settled: Boolean(earning.settlementId),
          createTime: earning.createTime,
          settledAt: earning.settledAt ?? undefined,
        })),
      };
    };
    if (mode === "enforce") return native();
    try {
      await native();
    } catch {
      getLogger("RelayProviderEarningsReadIam", LogCategory.SECURITY).warn(
        "Provider earnings shadow evaluation failed",
        { action, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return legacy();
  }
}

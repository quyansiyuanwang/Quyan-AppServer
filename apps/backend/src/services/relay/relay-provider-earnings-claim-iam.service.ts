import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { relayProviderSettlementArn } from "@/iam/resources/relay-provider-resources";
import { balanceTransactionArn } from "@/iam/resources/balance-transaction-resources";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { IamAccountUserRepository, iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import {
  RelayProviderEarningsClaimRepository,
  type RelayProviderEarningsClaimStore,
  type ProviderEarningsClaimGuard,
} from "@/store/relay/relay-provider-earnings-claim.repository";
import type { TypedRequest } from "@/types/express";
import { getLogger, LogCategory } from "@/util/logger";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
const action = "quyan:relay:ClaimMyProviderEarnings";
export class RelayProviderEarningsClaimIamService {
  private static instance: RelayProviderEarningsClaimIamService;
  static getInstance() {
    return (this.instance ??= new RelayProviderEarningsClaimIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: RelayProviderEarningsClaimStore = RelayProviderEarningsClaimRepository.getInstance(),
    private readonly users: Pick<IamAccountUserRepository, "targets"> = IamAccountUserRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  async claim(
    userId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<{ settledAmount: number; settlementId?: string }>,
  ) {
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
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
        await this.permissions.checkUserPermissions(userId, [Permission.RELAY_CHANNEL_PROVIDER_SETTLE], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const native = async (dryRun: boolean) => {
      const ids = [...new Set([userId, principal.accountOwnerId])],
        snapshot = await this.users.targets(principal, ids),
        policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal)),
        resources = new Set<string>(),
        generated = new Set<string>();
      const authorize = async (batch: readonly string[]) => {
        if (!batch.length || batch.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) throw iamAccountDenied();
        const outcomes = await platformCollectionDecisions(this.iam, { principal, action, request, resources: batch });
        if (outcomes.some((outcome) => outcome !== "Allow")) throw iamAccountDenied();
        batch.forEach((resource) => resources.add(resource));
      };
      const recheck = async () => {
        const current = await this.users.targets(principal, ids);
        if (
          snapshot.length !== ids.length ||
          current.length !== ids.length ||
          current.some(
            (row) =>
              !snapshot.some((old) => row.id === old.id && row.updateTime.getTime() === old.updateTime.getTime()),
          ) ||
          fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies
        )
          throw iamAccountDenied();
        const all = [...resources],
          limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
        for (let offset = 0; offset < all.length; offset += limit) await authorize(all.slice(offset, offset + limit));
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
      };
      const guard: ProviderEarningsClaimGuard = {
        users: { principal: { ...principal }, targetUserId: userId, users: snapshot, recheck },
        authorize,
        checkGenerated: async (kind, id) => {
          if (
            !["settlement", "transaction"].includes(kind) ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
            generated.has(kind + "/" + id)
          )
            throw iamAccountDenied();
          generated.add(kind + "/" + id);
          await authorize([
            kind === "settlement"
              ? relayProviderSettlementArn(principal.accountOwnerId, userId, id)
              : balanceTransactionArn(principal.accountOwnerId, userId, id),
          ]);
        },
      };
      await recheck();
      return this.repository.claim(guard, dryRun);
    };
    if (mode === "enforce") return native(false);
    try {
      await native(true);
    } catch {
      getLogger("RelayProviderEarningsClaimIam", LogCategory.SECURITY).warn("Provider claim shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}

import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformCarpoolDeliveryChannelReadRepository } from "@/store/billing/platform-carpool-delivery-channel-read.repository";
import type {
  PlatformCarpoolDeliveryChannelReadStore,
  PlatformCarpoolDeliveryChannelFilters,
} from "@/store/billing/platform-carpool-delivery-channel-read.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { carpoolPageQuerySchema } from "@/api/schema/billing/carpool.schema";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
export class PlatformCarpoolDeliveryChannelReadIamService {
  private static instance: PlatformCarpoolDeliveryChannelReadIamService;
  static getInstance() {
    return (this.instance ??= new PlatformCarpoolDeliveryChannelReadIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformCarpoolDeliveryChannelReadStore = PlatformCarpoolDeliveryChannelReadRepository.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  private async read<T>(
    operation: "ListDeliveryChannels",
    request: TypedRequest | undefined,
    native: (
      principal: IamPrincipal,
      decide: (resources: readonly string[]) => Promise<readonly string[]>,
      recheck: () => Promise<void>,
    ) => Promise<T>,
    legacy: () => Promise<T>,
  ) {
    const mode = env.security.iamAuthorizationMode,
      action = "quyan:carpool:" + operation;
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
        await this.permissions.checkUserPermissions(principal.subjectUserId, [Permission.CARPOOL_ORDER_FULFILL], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const evaluate = async () => {
      const snapshot = await this.snapshots.snapshot(principal, Permission.CARPOOL_ORDER_FULFILL),
        policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const recheck = async () => {
        await this.snapshots.recheck(principal, Permission.CARPOOL_ORDER_FULFILL, snapshot);
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
      getLogger("CarpoolDeliveryChannelReadIam", LogCategory.SECURITY).warn(
        "Carpool delivery channel shadow evaluation failed",
        {
          action,
          reason: "iam-evaluation-denied-or-unavailable",
        },
      );
    }
    return legacy();
  }
  async list(
    request: TypedRequest | undefined,
    filters: PlatformCarpoolDeliveryChannelFilters,
    legacy: () => Promise<Awaited<ReturnType<PlatformCarpoolDeliveryChannelReadStore["list"]>>>,
  ) {
    if (!carpoolPageQuerySchema.safeParse(filters).success) throw iamAccountDenied();
    return this.read(
      "ListDeliveryChannels",
      request,
      (principal, decide, recheck) => this.repository.list(principal, filters, decide, recheck),
      legacy,
    );
  }
}

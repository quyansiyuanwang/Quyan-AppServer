import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformCarpoolOrderReadRepository } from "@/store/billing/platform-carpool-order-read.repository";
import type {
  PlatformCarpoolOrderReadStore,
  PlatformCarpoolOrderFilters,
} from "@/store/billing/platform-carpool-order-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { carpoolPageQuerySchema } from "@/api/schema/billing/carpool.schema";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
export class PlatformCarpoolOrderReadIamService {
  private static instance: PlatformCarpoolOrderReadIamService;
  static getInstance() {
    return (this.instance ??= new PlatformCarpoolOrderReadIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformCarpoolOrderReadStore = PlatformCarpoolOrderReadRepository.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  private async read<T>(
    operation: "ListAdminOrders" | "GetAdminOrder",
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
        await this.permissions.checkUserPermissions(principal.subjectUserId, [Permission.CARPOOL_ORDER_READ], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const evaluate = async () => {
      const snapshot = await this.snapshots.snapshot(principal, Permission.CARPOOL_ORDER_READ),
        policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const recheck = async () => {
        await this.snapshots.recheck(principal, Permission.CARPOOL_ORDER_READ, snapshot);
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
      getLogger("CarpoolOrderReadIam", LogCategory.SECURITY).warn("Carpool order read shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
  async list(
    request: TypedRequest | undefined,
    filters: PlatformCarpoolOrderFilters,
    legacy: () => Promise<Awaited<ReturnType<PlatformCarpoolOrderReadStore["list"]>>>,
  ) {
    if (!carpoolPageQuerySchema.safeParse(filters).success) throw iamAccountDenied();
    return this.read(
      "ListAdminOrders",
      request,
      (principal, decide, recheck) => this.repository.list(principal, filters, decide, recheck),
      legacy,
    );
  }
  async get(
    request: TypedRequest | undefined,
    id: string,
    legacy: () => Promise<Awaited<ReturnType<PlatformCarpoolOrderReadStore["get"]>>>,
  ) {
    return this.read(
      "GetAdminOrder",
      request,
      (principal, decide, recheck) => this.repository.get(principal, id, decide, recheck),
      legacy,
    );
  }
}

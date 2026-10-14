import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import {
  platformCarpoolOrderArn,
  platformCarpoolRefundAccountArn,
  platformCarpoolRefundLedgerArn,
} from "@/iam/resources/platform-carpool-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { CarpoolRepository } from "@/store/billing/carpool.repository";
import { carpoolRefundRevision, type CarpoolOrderRefundGuard } from "@/store/billing/carpool-order-refund";
import { PermissionService } from "@/services/users/permission.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { failCarpoolOrderBodySchema } from "@/api/schema/billing/carpool.schema";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const action = "quyan:carpool:FailOrder";
export class PlatformCarpoolOrderRefundIamService {
  private static instance: PlatformCarpoolOrderRefundIamService;
  static getInstance() {
    return (this.instance ??= new PlatformCarpoolOrderRefundIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: Pick<
      CarpoolRepository,
      "findOrderRefundTarget" | "findRefundCustomerTargets"
    > = CarpoolRepository.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  async prepare(actorUserId: string | undefined, request: TypedRequest | undefined, id: string, reason: string) {
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode) || !isPlatformLogResourceId(id)) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return undefined;
    }
    const principal = getIamPrincipal(request);
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== actorUserId ||
      principal.principalUserId !== actorUserId
    )
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
    if (mode === "legacy") return undefined;
    if (!failCarpoolOrderBodySchema.safeParse({ reason }).success) throw iamAccountDenied();
    const native = async () => {
      const snapshot = await this.snapshots.snapshot(principal, Permission.CARPOOL_ORDER_FULFILL),
        policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal)),
        resources = new Set([platformCarpoolOrderArn(id)]);
      const evaluate = async (values: readonly string[]) => {
        for (let offset = 0; offset < values.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
          const decisions = await platformCollectionDecisions(this.iam, {
            principal,
            request,
            action,
            resources: values.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
          });
          if (decisions.some((decision) => decision !== "Allow")) throw iamAccountDenied();
        }
      };
      const recheck = async () => {
        await this.snapshots.recheck(principal, Permission.CARPOOL_ORDER_FULFILL, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
        await evaluate([...resources]);
        await this.snapshots.recheck(principal, Permission.CARPOOL_ORDER_FULFILL, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
      };
      await recheck();
      const record = await this.repository.findOrderRefundTarget(id);
      if (!record || record.id !== id || ![0, 1].includes(record.status)) throw iamAccountDenied();
      const ids = record.members.filter((row) => row.state !== "left").map((row) => row.userId);
      if (
        ids.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        new Set(ids).size !== ids.length ||
        ids.some((userId) => !isPlatformLogResourceId(userId))
      )
        throw iamAccountDenied();
      ids.forEach((userId) => {
        resources.add(platformUserArn(userId));
        resources.add(platformCarpoolRefundAccountArn(userId));
      });
      await recheck();
      const customers = await this.repository.findRefundCustomerTargets(ids);
      if (
        customers.length !== ids.length ||
        customers.some((row) => !ids.includes(row.id) || ![0, 1].includes(row.status))
      )
        throw iamAccountDenied();
      const guard: CarpoolOrderRefundGuard = {
        target: { record, revision: carpoolRefundRevision(record) },
        customers,
        reason,
        ledgers: [],
        group: snapshot.group,
        users: { principal: { ...principal }, targetUserId: principal.subjectUserId, users: snapshot.users, recheck },
        checkLedger: async (userId, ledgerId) => {
          if (
            !ids.includes(userId) ||
            !isPlatformLogResourceId(ledgerId) ||
            guard.ledgers.some((row) => row.userId === userId || row.id === ledgerId)
          )
            throw iamAccountDenied();
          resources.add(platformCarpoolRefundLedgerArn(userId, ledgerId));
          await recheck();
          guard.ledgers.push({ userId, id: ledgerId });
        },
      };
      await recheck();
      return guard;
    };
    if (mode === "enforce") return native();
    try {
      await native();
    } catch {
      getLogger("CarpoolOrderRefundIam", LogCategory.SECURITY).warn("Carpool refund shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return undefined;
  }
}

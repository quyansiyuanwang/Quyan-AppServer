import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { platformCarpoolOrderArn, platformCarpoolDeliveryTokenArn } from "@/iam/resources/platform-carpool-resources";
import { platformMonthlyPassArn } from "@/iam/resources/platform-monthly-pass-resources";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { CarpoolRepository } from "@/store/billing/carpool.repository";
import { carpoolOrderManagementRevision } from "@/store/billing/carpool-order-management-write";
import type { CarpoolOrderDeliveryGuard } from "@/store/billing/carpool-order-delivery";
import { PermissionService } from "@/services/users/permission.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { fulfillCarpoolOrderBodySchema } from "@/api/schema/billing/carpool.schema";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const action = "quyan:carpool:FulfillOrder";
export class PlatformCarpoolOrderDeliveryIamService {
  private static instance: PlatformCarpoolOrderDeliveryIamService;
  static getInstance() {
    return (this.instance ??= new PlatformCarpoolOrderDeliveryIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: Pick<
      CarpoolRepository,
      "findOrderManagementTarget" | "findRefundCustomerTargets" | "findDeliveryTemplateId"
    > = CarpoolRepository.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  async prepare(actorUserId: string | undefined, request: TypedRequest | undefined, id: string, channelId: string) {
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode) || ![id, channelId].every(isPlatformLogResourceId))
      throw iamAccountDenied();
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
    if (!fulfillCarpoolOrderBodySchema.safeParse({ relayChannelId: channelId }).success) throw iamAccountDenied();
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
      const record = await this.repository.findOrderManagementTarget(id);
      if (!record || record.id !== id || ![0, 1].includes(record.status)) throw iamAccountDenied();
      resources.add(platformRelayChannelArn(channelId));
      resources.add(platformTemplateArn("carpool", record.packageTemplateId));
      await recheck();
      const templateId = await this.repository.findDeliveryTemplateId(record);
      if (!isPlatformLogResourceId(templateId)) throw iamAccountDenied();
      resources.add(platformTemplateArn("monthly-pass", templateId));
      const ids = record.members.filter((row) => row.state !== "left").map((row) => row.userId);
      if (
        ids.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        new Set(ids).size !== ids.length ||
        ids.some((userId) => !isPlatformLogResourceId(userId))
      )
        throw iamAccountDenied();
      ids.forEach((userId) => {
        resources.add(platformUserArn(userId));
      });
      await recheck();
      const customers = await this.repository.findRefundCustomerTargets(ids);
      if (
        customers.length !== ids.length ||
        customers.some((row) => !ids.includes(row.id) || ![0, 1].includes(row.status))
      )
        throw iamAccountDenied();
      const guard: CarpoolOrderDeliveryGuard = {
        target: { record, revision: carpoolOrderManagementRevision(record) },
        customers,
        channelId,
        templateId,
        deliveries: [],
        group: snapshot.group,
        users: { principal: { ...principal }, targetUserId: principal.subjectUserId, users: snapshot.users, recheck },
        checkDelivery: async (userId, passId, tokenId) => {
          if (
            !ids.includes(userId) ||
            ![passId, tokenId].every(isPlatformLogResourceId) ||
            guard.deliveries.some((row) => row.userId === userId || row.passId === passId || row.tokenId === tokenId)
          )
            throw iamAccountDenied();
          resources.add(platformMonthlyPassArn(userId, passId));
          resources.add(platformCarpoolDeliveryTokenArn(userId, tokenId));
          await recheck();
          guard.deliveries.push({ userId, passId, tokenId });
        },
      };
      await recheck();
      return guard;
    };
    if (mode === "enforce") return native();
    try {
      await native();
    } catch {
      getLogger("CarpoolOrderDeliveryIam", LogCategory.SECURITY).warn("Carpool delivery shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return undefined;
  }
}

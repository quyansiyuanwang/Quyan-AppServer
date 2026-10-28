import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { PlatformResourceReadIamService } from "@/services/system/platform-resource-read-iam.service";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import {
  PlatformTicketAssignmentRepository,
  sameTicketAssignmentTarget,
} from "@/store/ticket/platform-ticket-assignment.repository";
import type { PlatformTicketAssignmentStore } from "@/store/ticket/platform-ticket-assignment.store";
import { platformTicketAssignmentArn } from "@/iam/resources/platform-ticket-assignment-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { normalizeTicketAssignmentRules } from "@/util/ticket-assignment-rules";
import { PermissionService } from "@/services/users/permission.service";
import { TicketService } from "./ticket.service";
import BusinessLogService from "@/services/system/businesslog.service";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { CONFIG_KEYS } from "@/constant/config-keys";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { SetTicketReviewAssignmentConfigDto, TicketReviewAssignmentConfigDto } from "@/api/dto/ticket/ticket.dto";
const permission = Permission.TICKET_REVIEW_UPDATE;
export class PlatformTicketAssignmentIamService {
  private static instance: PlatformTicketAssignmentIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformTicketAssignmentStore = PlatformTicketAssignmentRepository.getInstance(),
    private readonly legacy: Pick<
      TicketService,
      "getAssignmentConfig" | "updateAssignmentConfig"
    > = TicketService.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
    private readonly logs: Pick<BusinessLogService, "logOperation"> = BusinessLogService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformTicketAssignmentIamService());
  }
  private principal(request: TypedRequest) {
    const principal = getIamPrincipal(request);
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== principal.principalUserId ||
      !["enforce", "shadow", "legacy"].includes(env.security.iamAuthorizationMode)
    )
      throw iamAccountDenied();
    return { ...principal };
  }
  private async legacyAllowed(request: TypedRequest) {
    const principal = this.principal(request);
    if (
      !(
        await this.permissions.checkUserPermissions(principal.subjectUserId, [permission], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    return principal;
  }
  private shadow(action: string) {
    getLogger("TicketAssignmentIam", LogCategory.SECURITY).warn("Ticket assignment shadow evaluation failed", {
      action,
      reason: "iam-evaluation-denied-or-unavailable",
    });
  }
  async read(request: TypedRequest): Promise<TicketReviewAssignmentConfigDto> {
    const principal = this.principal(request),
      mode = env.security.iamAuthorizationMode,
      action = "quyan:ticket:GetAssignmentRules";
    const native = () =>
      new PlatformResourceReadIamService(this.iam, this.snapshots).read(
        action,
        principal,
        request,
        platformTicketAssignmentArn(),
        async (guard) => {
          const target = await this.repository.target(principal);
          guard.trackSource(async () => {
            if (!sameTicketAssignmentTarget(await this.repository.target(principal), target)) throw iamAccountDenied();
          });
          const value = await this.repository.hydrate(principal, target);
          if (value === null) return { rules: [] };
          try {
            return normalizeTicketAssignmentRules({ rules: JSON.parse(value) });
          } catch {
            throw iamAccountDenied();
          }
        },
      );
    if (mode === "enforce") return native();
    await this.legacyAllowed(request);
    if (mode === "shadow")
      try {
        await native();
      } catch {
        this.shadow(action);
      }
    return this.legacy.getAssignmentConfig();
  }
  async update(
    input: SetTicketReviewAssignmentConfigDto,
    request: TypedRequest,
  ): Promise<TicketReviewAssignmentConfigDto> {
    const principal = this.principal(request),
      mode = env.security.iamAuthorizationMode,
      action = "quyan:ticket:UpdateAssignmentRules",
      data = normalizeTicketAssignmentRules(input);
    const native = async (persist: boolean) => {
      // Prepare the read guard first; the repository performs final checks inside the write transaction.
      const prepared = await new PlatformResourceReadIamService(this.iam, this.snapshots).read(
        action,
        principal,
        request,
        platformTicketAssignmentArn(),
        async (guard) => {
          const target = await this.repository.target(principal),
            authorizationRevision = await this.repository.authorizationRevision(principal),
            snapshot = await this.snapshots.snapshot(principal, permission);
          if (!persist)
            guard.trackSource(async () => {
              if (!sameTicketAssignmentTarget(await this.repository.target(principal), target))
                throw iamAccountDenied();
            });
          return {
            target,
            guard: {
              group: snapshot.group,
              authorizationRevision,
              users: {
                principal,
                targetUserId: principal.subjectUserId,
                users: snapshot.users,
                recheck: async () => {
                  await guard.recheck();
                  await this.snapshots.recheck(principal, permission, snapshot);
                  if ((await this.repository.authorizationRevision(principal)) !== authorizationRevision)
                    throw iamAccountDenied();
                },
              },
            },
          };
        },
      );
      if (persist) await this.repository.update(JSON.stringify(data.rules), prepared.target, prepared.guard);
    };
    if (mode !== "enforce") {
      await this.legacyAllowed(request);
      if (mode === "shadow")
        try {
          await native(false);
        } catch {
          this.shadow(action);
        }
      return this.legacy.updateAssignmentConfig(data, principal.subjectUserId, request);
    }
    await native(true);
    await this.logs.logOperation({
      operationType: OperationType.SYSTEM_CONFIG_UPDATE,
      operationCategory: OperationCategory.SYSTEM,
      actorUserId: principal.subjectUserId,
      targetResourceType: "SERVER_CONFIG",
      description: "Updated ticket assignment rules",
      changes: {
        key: CONFIG_KEYS.NOTIFICATION.TICKET_ASSIGNMENT_RULES,
        ruleCount: data.rules.length,
        assigneeCount: new Set(data.rules.flatMap((rule) => rule.assigneeUserIds)).size,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
    return data;
  }
}

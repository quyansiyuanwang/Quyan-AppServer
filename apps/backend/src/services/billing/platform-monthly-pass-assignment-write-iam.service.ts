import {
  Permission,
  IAM_MONTHLY_PASS_ASSIGNMENT_WRITE_OPERATIONS,
  type IamMonthlyPassAssignmentWriteOperation,
} from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { platformMonthlyPassArn } from "@/iam/resources/platform-monthly-pass-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { MonthlyPassRepository } from "@/store/billing/monthly-pass.repository";
import type { MonthlyPassStore } from "@/store/billing/monthly-pass.store";
import {
  monthlyPassAssignmentRevision,
  type MonthlyPassAssignmentWriteGuard,
} from "@/store/billing/monthly-pass-assignment-write";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "../users/permission.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
export class PlatformMonthlyPassAssignmentWriteIamService {
  private static instance: PlatformMonthlyPassAssignmentWriteIamService;
  static getInstance() {
    return (this.instance ??= new PlatformMonthlyPassAssignmentWriteIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: Pick<
      MonthlyPassStore,
      "findUserPassById" | "findUserPassIdentity"
    > = MonthlyPassRepository.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  async prepare(
    operation: IamMonthlyPassAssignmentWriteOperation,
    actorUserId: string,
    request: TypedRequest | undefined,
    id: string,
    deleteViaUpdate = false,
  ) {
    const mode = env.security.iamAuthorizationMode;
    if (
      !IAM_MONTHLY_PASS_ASSIGNMENT_WRITE_OPERATIONS.some((entry) => entry.operation === operation) ||
      !["legacy", "shadow", "enforce"].includes(mode) ||
      !isPlatformLogResourceId(id) ||
      (deleteViaUpdate && operation !== "UpdateUserPass")
    )
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
        await this.permissions.checkUserPermissions(actorUserId, [Permission.MONTHLY_PASS_ASSIGNMENT_WRITE], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return undefined;
    const native = async () => {
      const action = "quyan:monthly_pass:" + operation,
        snapshot = await this.snapshots.snapshot(principal, Permission.MONTHLY_PASS_ASSIGNMENT_WRITE),
        policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const identity = await this.repository.findUserPassIdentity(id);
      if (
        !identity ||
        identity.id !== id ||
        ![0, 1].includes(identity.status) ||
        !isPlatformLogResourceId(identity.userId)
      )
        throw iamAccountDenied();
      const resource = platformMonthlyPassArn(identity.userId, id);
      if (
        (await platformCollectionDecisions(this.iam, { action, principal, request, resources: [resource] }))[0] !==
        "Allow"
      )
        throw iamAccountDenied();
      const record = await this.repository.findUserPassById(id);
      if (
        !record ||
        record.id !== id ||
        record.userId !== identity.userId ||
        ![0, 1].includes(record.status) ||
        !isPlatformLogResourceId(record.userId) ||
        !isPlatformLogResourceId(record.templateId)
      )
        throw iamAccountDenied();
      const evaluate = async () => {
        const primary = (
          await platformCollectionDecisions(this.iam, { action, principal, request, resources: [resource] })
        )[0];
        if (primary !== "Allow") throw iamAccountDenied();
        if (
          deleteViaUpdate &&
          (
            await platformCollectionDecisions(this.iam, {
              action: "quyan:monthly_pass:DeleteUserPass",
              principal,
              request,
              resources: [resource],
            })
          )[0] !== "Allow"
        )
          throw iamAccountDenied();
        const references =
          operation === "UpdateUserPass"
            ? [platformUserArn(record.userId), platformTemplateArn("monthly-pass", record.templateId)]
            : [];
        const decisions = await platformCollectionDecisions(this.iam, {
          action,
          principal,
          request,
          resources: references,
        });
        return { username: decisions[0] === "Allow", template: decisions[1] === "Allow" };
      };
      const response = await evaluate();
      const recheck = async () => {
        await this.snapshots.recheck(principal, Permission.MONTHLY_PASS_ASSIGNMENT_WRITE, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
        const current = await evaluate();
        if (current.username !== response.username || current.template !== response.template) throw iamAccountDenied();
        await this.snapshots.recheck(principal, Permission.MONTHLY_PASS_ASSIGNMENT_WRITE, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
      };
      await recheck();
      const guard: MonthlyPassAssignmentWriteGuard = {
        operation,
        deleteViaUpdate,
        target: { record, revision: monthlyPassAssignmentRevision(record) },
        response,
        group: snapshot.group,
        users: { principal: { ...principal }, targetUserId: actorUserId, users: snapshot.users, recheck },
      };
      return { guard, target: guard.target };
    };
    if (mode === "enforce") return native();
    try {
      await native();
    } catch {
      getLogger("MonthlyPassAssignmentIam", LogCategory.SECURITY).warn("Assignment write shadow evaluation failed", {
        action: "quyan:monthly_pass:" + operation,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return undefined;
  }
}

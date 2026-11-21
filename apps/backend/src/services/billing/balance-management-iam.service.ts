import { Permission, IAM_BALANCE_MANAGEMENT_OPERATIONS } from "@quyan/shared";
import { env } from "@/config/env";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { platformSystemArn } from "@/iam/resources/platform-system-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { PermissionService } from "@/services/users/permission.service";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { platformManagementGroupSnapshot } from "@/store/users/platform-management-principal";
import { readIamAuthorizationRevision } from "@/store/users/iam-authorization-revision";
import type { TypedRequest } from "@/types/express";
import { Prisma } from "@prisma/client";
import { getLogger, LogCategory } from "@/util/logger";
import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";

export function managedBalanceArn(userId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) throw iamAccountDenied();
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "balance-account/" + userId,
  });
}
export interface BalanceManagementGuard {
  actorUserId: string;
  identityUserIds: string[];
  allowed(userIds: string[]): Promise<Set<string>>;
  recheck(tx?: Prisma.TransactionClient): Promise<void>;
}
export class BalanceManagementIamService {
  private static instance: BalanceManagementIamService;
  static getInstance() {
    return (this.instance ??= new BalanceManagementIamService());
  }
  async prepare(
    operation: (typeof IAM_BALANCE_MANAGEMENT_OPERATIONS)[number]["operation"],
    request: TypedRequest,
    targets: string[] = [],
  ): Promise<BalanceManagementGuard> {
    const definition = IAM_BALANCE_MANAGEMENT_OPERATIONS.find((row) => row.operation === operation);
    const principal = getIamPrincipal(request);
    const mode = env.security.iamAuthorizationMode;
    if (
      !definition ||
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== principal.principalUserId ||
      !["legacy", "shadow", "enforce"].includes(mode)
    )
      throw iamAccountDenied();
    const snapshots = PlatformManagementReadRepository.getInstance();
    const iam = IamAuthorizationService.getInstance();
    const permission: Permission = definition.permission;
    const snapshot = await snapshots.snapshot(principal, permission);
    const hash = mode === "legacy" ? "" : fingerprintIamPolicies(await iam.loadPolicies(principal));
    const action = "quyan:balance:" + operation;
    const resources = targets.map(managedBalanceArn);
    let transactionRevision: string | undefined;
    const evaluate = async (values: string[]) => {
      if (mode === "legacy") return values.map(() => "Allow" as const);
      const decisions = await platformCollectionDecisions(iam, { principal, request, action, resources: values });
      if (mode === "shadow" && decisions.some((v) => v !== "Allow"))
        getLogger("BalanceManagementIam", LogCategory.SECURITY).warn("Balance management shadow denied", { action });
      return mode === "shadow" ? values.map(() => "Allow" as const) : decisions;
    };
    const recheck = async (tx?: Prisma.TransactionClient) => {
      await snapshots.recheck(principal, permission, snapshot);
      if (tx) {
        const ids = snapshot.users.map((row) => row.id).sort();
        await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id=${snapshot.group.id} FOR UPDATE`);
        const current = await platformManagementGroupSnapshot(principal, permission, tx);
        if (current.id !== snapshot.group.id || current.updateTime.getTime() !== snapshot.group.updateTime.getTime())
          throw iamAccountDenied();
        const revision = await readIamAuthorizationRevision(tx, principal.accountOwnerId);
        if (transactionRevision !== undefined && transactionRevision !== revision) throw iamAccountDenied();
        transactionRevision = revision;
      }
      if (
        mode !== "enforce" &&
        !(
          await PermissionService.getInstance().checkUserPermissions(principal.subjectUserId, [permission], {
            assumedRoleSessionId: principal.roleSessionId,
          })
        ).hasPermission
      )
        throw iamAccountDenied();
      if (mode !== "legacy" && fingerprintIamPolicies(await iam.loadPolicies(principal)) !== hash)
        throw iamAccountDenied();
      if ((await evaluate([platformSystemArn("balance-management"), ...resources])).some((v) => v !== "Allow"))
        throw iamAccountDenied();
    };
    await recheck();
    return {
      actorUserId: principal.subjectUserId,
      identityUserIds: snapshot.users.map((row) => row.id),
      allowed: async (userIds) => {
        const decisions = await evaluate(userIds.map(managedBalanceArn));
        return new Set(userIds.filter((_, index) => decisions[index] === "Allow"));
      },
      recheck,
    };
  }
}

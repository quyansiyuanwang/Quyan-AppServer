import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { createHash } from "node:crypto";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import {
  platformTerminalEntitlementArn,
  platformTerminalBindingArn,
  platformTerminalRegistrationTokenArn,
} from "@/iam/resources/platform-terminal-entitlement-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import {
  PlatformTerminalEntitlementReadRepository,
  validTerminalEntitlementTarget,
} from "@/store/remote-terminal-product/platform-terminal-entitlement-read.repository";
import type {
  PlatformTerminalEntitlementReadStore,
  TerminalEntitlementFilters,
  TerminalEntitlementTarget,
  TerminalEntitlementProjection,
  TerminalEntitlementReadView,
} from "@/store/remote-terminal-product/platform-terminal-entitlement-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformMetadataCollectionIamService } from "@/services/system/platform-metadata-collection-iam.service";
import { PermissionService } from "@/services/users/permission.service";
import type { TypedRequest } from "@/types/express";
import { getLogger, LogCategory } from "@/util/logger";

const action = "quyan:remote_terminal:ListEntitlements";
const batchSize = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
/** Admit primary rows and every related public contribution before page-only hydration. */
export class PlatformTerminalEntitlementReadIamService {
  private static instance: PlatformTerminalEntitlementReadIamService;
  static getInstance() {
    return (this.instance ??= new PlatformTerminalEntitlementReadIamService());
  }
  constructor(
    private readonly repository: PlatformTerminalEntitlementReadStore = PlatformTerminalEntitlementReadRepository.getInstance(),
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  private decisions(principal: IamPrincipal, request: TypedRequest, resources: readonly string[]) {
    return platformCollectionDecisions(this.iam, { action, principal, request, resources });
  }
  private async project(principal: IamPrincipal, request: TypedRequest, target: TerminalEntitlementTarget) {
    const references = [
      { key: "username" as const, arn: platformUserArn(target.userId) },
      ...(target.assignedBy ? [{ key: "assignedByUsername" as const, arn: platformUserArn(target.assignedBy) }] : []),
      ...(target.templateId
        ? [{ key: "templateName" as const, arn: platformTemplateArn("remote-terminal", target.templateId) }]
        : []),
      ...(target.tokenId
        ? [
            {
              key: "tokenMetadata" as const,
              arn: platformTerminalRegistrationTokenArn(target.userId, target.id, target.tokenId),
            },
          ]
        : []),
    ];
    const decisions = await this.decisions(
      principal,
      request,
      references.map((ref) => ref.arn),
    );
    const projection: TerminalEntitlementProjection = {
      username: false,
      assignedByUsername: false,
      templateName: false,
      tokenMetadata: false,
    };
    references.forEach((ref, index) => {
      projection[ref.key] = decisions[index] === "Allow";
    });
    const hash = createHash("sha256");
    hash.update(JSON.stringify(references.map((ref, index) => [ref.arn, decisions[index]])));
    let after: string | undefined,
      count = 0,
      complete = true;
    for (;;) {
      const rows = await this.repository.scanDevices(target, after);
      if (
        !Array.isArray(rows) ||
        rows.length > batchSize ||
        rows.some(
          (row, index) =>
            !row ||
            !isPlatformLogResourceId(row.id) ||
            row.userId !== target.userId ||
            row.entitlementId !== target.id ||
            ![0, 1].includes(row.status) ||
            (after !== undefined && row.id <= after) ||
            (index > 0 && row.id <= rows[index - 1]!.id),
        )
      )
        throw iamAccountDenied();
      if (!rows.length) break;
      const outcomes = await this.decisions(
        principal,
        request,
        rows.map((row) => platformTerminalBindingArn(row.userId, row.id)),
      );
      rows.forEach((row, index) => {
        hash.update(JSON.stringify([row.id, row.userId, row.entitlementId, row.status, outcomes[index]]) + "\n");
        complete &&= outcomes[index] === "Allow";
        count++;
      });
      if (!Number.isSafeInteger(count)) throw iamAccountDenied();
      after = rows[rows.length - 1]!.id;
      if (rows.length < batchSize) break;
    }
    if (complete) projection.registeredDeviceCount = count;
    return { projection, signature: hash.digest("hex") };
  }
  async list<T>(
    request: TypedRequest,
    pagination: { page: number; pageSize: number },
    filters: TerminalEntitlementFilters,
    map: (view: TerminalEntitlementReadView) => T,
    legacy: () => Promise<{ total: number; records: T[] }>,
  ) {
    const principal = request && getIamPrincipal(request),
      mode = env.security.iamAuthorizationMode;
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== principal.principalUserId ||
      !["legacy", "shadow", "enforce"].includes(mode) ||
      !Number.isSafeInteger(pagination.page) ||
      pagination.page < 1 ||
      !Number.isSafeInteger(pagination.pageSize) ||
      pagination.pageSize < 1 ||
      pagination.pageSize > 100 ||
      !Number.isSafeInteger(pagination.page * pagination.pageSize)
    )
      throw iamAccountDenied();
    const native = async () => {
      const selected: TerminalEntitlementTarget[] = [],
        projections = new Map<string, TerminalEntitlementProjection>();
      const result = await new PlatformMetadataCollectionIamService(
        this.iam,
        this.snapshots,
        this.repository,
        (target) => platformTerminalEntitlementArn(target.userId, target.id),
        async (target) => {
          const { projection, signature } = await this.project(principal, request, target);
          projections.set(target.id, projection);
          return [target.revision, target.displayOrder, signature, projection];
        },
        validTerminalEntitlementTarget,
      ).read(action, principal, request, filters, {
        visit: async (targets) => {
          selected.push(...targets);
        },
        finish: async (total) => {
          selected.sort((a, b) => a.displayOrder - b.displayOrder);
          const page = selected.slice(
            (pagination.page - 1) * pagination.pageSize,
            pagination.page * pagination.pageSize,
          );
          const views = await this.repository.hydrate(
            principal,
            page.map((target) => {
              const projection = projections.get(target.id);
              if (!projection) throw iamAccountDenied();
              return { target, projection };
            }),
          );
          if (
            !Array.isArray(views) ||
            views.length !== page.length ||
            views.some(
              (view, index) =>
                !view || view.record.id !== page[index]?.id || view.record.userId !== page[index]?.userId,
            )
          )
            throw iamAccountDenied();
          return { total, records: views.map(map), ...pagination };
        },
      });
      if (!result) throw iamAccountDenied();
      return result;
    };
    if (mode === "enforce") return native();
    if (
      !(
        await this.permissions.checkUserPermissions(
          principal.subjectUserId,
          [Permission.REMOTE_TERMINAL_ASSIGNMENT_READ],
          { assumedRoleSessionId: principal.roleSessionId },
        )
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "shadow")
      try {
        await native();
      } catch {
        getLogger("PlatformTerminalEntitlementIam", LogCategory.SECURITY).warn("Entitlement shadow evaluation failed", {
          action,
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    return { ...(await legacy()), ...pagination };
  }
}

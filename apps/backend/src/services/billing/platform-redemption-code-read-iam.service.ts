import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { iamManagementPaginationSchema } from "@/iam/management-pagination";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import {
  platformRedemptionCodeArn,
  platformRedemptionCodeCollectionArn,
} from "@/iam/resources/platform-redemption-code-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import {
  PlatformRedemptionCodeReadRepository,
  sameRedemptionCodeTargets,
  validRedemptionCodeTarget,
} from "@/store/billing/platform-redemption-code-read.repository";
import type {
  PlatformRedemptionCodeReadStore,
  RedemptionCodeReadTarget,
} from "@/store/billing/platform-redemption-code-read.store";
import { PlatformResourceReadIamService } from "@/services/system/platform-resource-read-iam.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { RedemptionCodeService } from "./redemption-code.service";
import { Permission } from "@quyan/shared";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const action = "quyan:redemption_code:ListCodes",
  size = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
export class PlatformRedemptionCodeReadIamService {
  private static instance: PlatformRedemptionCodeReadIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformRedemptionCodeReadStore = PlatformRedemptionCodeReadRepository.getInstance(),
    private readonly legacy: Pick<RedemptionCodeService, "listCodes"> = RedemptionCodeService.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformRedemptionCodeReadIamService());
  }
  async list(request: TypedRequest, pagination: { page?: number; pageSize?: number } = {}) {
    const identity = getIamPrincipal(request),
      mode = env.security.iamAuthorizationMode;
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !["enforce", "legacy", "shadow"].includes(mode)
    )
      throw iamAccountDenied();
    const parsed = iamManagementPaginationSchema.safeParse(pagination);
    if (!parsed.success)
      throw new BadRequestError("Invalid redemption pagination", undefined, { messageKey: "errors.badRequest" });
    const principal = { ...identity },
      { page, pageSize } = parsed.data;
    const native = async () =>
      new PlatformResourceReadIamService(this.iam, this.snapshots).read(
        action,
        principal,
        request,
        platformRedemptionCodeCollectionArn(),
        async (guard) => {
          const admitted: RedemptionCodeReadTarget[] = [],
            seen = new Set<string>();
          let after: string | undefined;
          while (true) {
            await guard.recheck();
            const targets = await this.repository.scan(principal, after);
            if (
              !Array.isArray(targets) ||
              targets.length > size ||
              targets.some(
                (row, index) =>
                  !validRedemptionCodeTarget(row) ||
                  seen.has(row.id) ||
                  (after !== undefined && row.id <= after) ||
                  (index > 0 && row.id <= targets[index - 1]!.id),
              )
            )
              throw iamAccountDenied();
            const allowed = await guard.allowed(targets.map((row) => platformRedemptionCodeArn(row.id)));
            for (const row of targets) {
              seen.add(row.id);
              if (allowed.has(platformRedemptionCodeArn(row.id)))
                admitted.push({ ...row, createTime: new Date(row.createTime), updateTime: new Date(row.updateTime) });
            }
            if (targets.length < size) break;
            after = targets[targets.length - 1]!.id;
          }
          guard.trackSource(async () => {
            for (let index = 0; index < admitted.length; index += size) {
              const batch = admitted.slice(index, index + size);
              sameRedemptionCodeTargets(await this.repository.recheck(principal, batch), batch);
            }
          });
          admitted.sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || b.id.localeCompare(a.id));
          const selected = admitted.slice((page - 1) * pageSize, page * pageSize);
          await guard.recheck();
          const rows = await this.repository.hydrate(principal, selected);
          if (
            !Array.isArray(rows) ||
            rows.length !== selected.length ||
            new Set(rows.map((row) => row.id)).size !== rows.length ||
            rows.some((row) => row.status !== 1 || !selected.some((target) => target.id === row.id))
          )
            throw iamAccountDenied();
          const byId = new Map(rows.map((row) => [row.id, row]));
          return {
            total: admitted.length,
            page,
            pageSize,
            records: selected.map((target) => {
              const row = byId.get(target.id)!;
              return {
                id: row.id,
                code: row.code,
                amount: Number(row.amount),
                usedBy: row.usedBy,
                usedByUsername: row.usedByUser?.username,
                usedAt: row.usedAt,
                createdBy: row.createdBy,
                createdByUsername: row.createdByUser?.username,
                expiresAt: row.expiresAt,
                createTime: row.createTime,
              };
            }),
          };
        },
      );
    if (mode === "enforce") return native();
    if (
      !(
        await this.permissions.checkUserPermissions(principal.subjectUserId, [Permission.REDEMPTION_CODE_READ], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "shadow")
      try {
        await native();
      } catch {
        getLogger("RedemptionCodeIam", LogCategory.SECURITY).warn("Redemption code shadow evaluation failed", {
          action,
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    return this.legacy.listCodes(pagination.page, pagination.pageSize);
  }
}

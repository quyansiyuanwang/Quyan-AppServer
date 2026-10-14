import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { IamAccountUserRepository, iamAccountDenied } from "@/store/users/iam-account-principal";
import type { IamPrincipal } from "@quyan/shared";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
export interface TerminalPersonalCollectionStore<TView> {
  list(
    principal: IamPrincipal,
    pagination: { page: number; pageSize: number },
    status: number | undefined,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
  ): Promise<{ total: number; records: TView[] }>;
}
export abstract class TerminalPersonalCollectionIamService<TView extends { record: { id: string; userId: string } }> {
  protected constructor(
    private readonly action: "quyan:remote_terminal:ListMyEntitlements" | "quyan:remote_terminal:ListMyDevices",
    private readonly iam: Pick<IamAuthorizationService, "loadPolicies" | "authorizeMany">,
    private readonly repository: TerminalPersonalCollectionStore<TView>,
    private readonly users: Pick<IamAccountUserRepository, "targets">,
  ) {}
  async list<T>(
    userId: string,
    request: TypedRequest | undefined,
    pagination: { page: number; pageSize: number },
    status: number | undefined,
    map: (view: TView) => T,
    legacy: () => Promise<{ total: number; records: T[] }>,
  ) {
    const mode = env.security.iamAuthorizationMode,
      action = this.action;
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
    if (mode === "legacy") return legacy();
    const native = async () => {
      const ids = [...new Set([userId, principal.accountOwnerId])],
        snapshot = await this.users.targets(principal, ids),
        policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
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
      };
      await recheck();
      const result = await this.repository.list(
        principal,
        pagination,
        status,
        (resources) => platformCollectionDecisions(this.iam, { action, principal, request, resources }),
        recheck,
      );
      if (
        !result ||
        !Number.isSafeInteger(result.total) ||
        result.total < 0 ||
        !Array.isArray(result.records) ||
        result.records.length > pagination.pageSize ||
        result.records.some((view) => view.record.userId !== userId)
      )
        throw iamAccountDenied();
      await recheck();
      return { total: result.total, records: result.records.map(map), ...pagination };
    };
    if (mode === "enforce") return native();
    try {
      await native();
    } catch {
      getLogger("TerminalPersonalCollectionIam", LogCategory.SECURITY).warn(
        "Personal entitlement list shadow evaluation failed",
        { action, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return legacy();
  }
}

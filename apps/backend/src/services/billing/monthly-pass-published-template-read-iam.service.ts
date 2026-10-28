import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { IamAccountUserRepository, iamAccountDenied } from "@/store/users/iam-account-principal";
import { MonthlyPassPublishedTemplateReadRepository } from "@/store/billing/monthly-pass-published-template-read.repository";
import type {
  MonthlyPassPublishedTemplate,
  MonthlyPassPublishedTemplateReadStore,
} from "@/store/billing/monthly-pass-published-template-read.store";
import type { TypedRequest } from "@/types/express";
import { getLogger, LogCategory } from "@/util/logger";
import { createIamPersonalReadRecheck } from "@/iam/collection/personal-collection.service";
const action = "quyan:monthly_pass:ListPublishedTemplates";
export class MonthlyPassPublishedTemplateReadIamService {
  private static instance: MonthlyPassPublishedTemplateReadIamService;
  static getInstance() {
    return (this.instance ??= new MonthlyPassPublishedTemplateReadIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: MonthlyPassPublishedTemplateReadStore = MonthlyPassPublishedTemplateReadRepository.getInstance(),
    private readonly users: Pick<IamAccountUserRepository, "targets"> = IamAccountUserRepository.getInstance(),
  ) {}
  async list<T>(
    request: TypedRequest | undefined,
    map: (record: MonthlyPassPublishedTemplate) => T,
    legacy: () => Promise<T[]>,
  ) {
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const principal = getIamPrincipal(request);
    if (!principal || request.oauthAccessToken || principal.subjectUserId !== principal.principalUserId)
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const native = async () => {
      const recheck = await createIamPersonalReadRecheck(principal, this.iam, this.users);
      await recheck();
      const records = await this.repository.list(
        principal,
        (resources) => platformCollectionDecisions(this.iam, { principal, action, request, resources }),
        recheck,
      );
      if (
        !Array.isArray(records) ||
        records.some((row) => !row || row.status !== 1 || row.publishStatus !== "published")
      )
        throw iamAccountDenied();
      await recheck();
      return records.map(map);
    };
    if (mode === "enforce") return native();
    try {
      await native();
    } catch {
      getLogger("MonthlyPassPublishedTemplateReadIam", LogCategory.SECURITY).warn(
        "Published offer shadow evaluation failed",
        { action, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return legacy();
  }
}

import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { IamAccountUserRepository, iamAccountDenied } from "@/store/users/iam-account-principal";
import { TerminalPublishedTemplateReadRepository } from "@/store/remote-terminal-product/terminal-published-template-read.repository";
import type {
  TerminalPublishedTemplate,
  TerminalPublishedTemplateReadStore,
} from "@/store/remote-terminal-product/terminal-published-template-read.store";
import type { TypedRequest } from "@/types/express";
import { getLogger, LogCategory } from "@/util/logger";
import { createTerminalPersonalReadRecheck } from "./terminal-personal-collection-iam.service";
const action = "quyan:remote_terminal:ListPublishedTemplates";
export class TerminalPublishedTemplateReadIamService {
  private static instance: TerminalPublishedTemplateReadIamService;
  static getInstance() {
    return (this.instance ??= new TerminalPublishedTemplateReadIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: TerminalPublishedTemplateReadStore = TerminalPublishedTemplateReadRepository.getInstance(),
    private readonly users: Pick<IamAccountUserRepository, "targets"> = IamAccountUserRepository.getInstance(),
  ) {}
  async list<T>(
    request: TypedRequest | undefined,
    map: (record: TerminalPublishedTemplate) => T,
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
      const recheck = await createTerminalPersonalReadRecheck(principal, this.iam, this.users);
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
      getLogger("TerminalPublishedTemplateReadIam", LogCategory.SECURITY).warn(
        "Published offer shadow evaluation failed",
        { action, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return legacy();
  }
}

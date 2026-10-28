import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { IamAccountUserRepository } from "@/store/users/iam-account-principal";
import { TerminalPersonalEntitlementReadRepository } from "@/store/remote-terminal-product/terminal-personal-entitlement-read.repository";
import type { TerminalPersonalEntitlementReadStore } from "@/store/remote-terminal-product/terminal-personal-entitlement-read.store";
import type { TerminalEntitlementReadView } from "@/store/remote-terminal-product/platform-terminal-entitlement-read.store";
import { TerminalPersonalCollectionIamService } from "./terminal-personal-collection-iam.service";
export class TerminalPersonalEntitlementReadIamService extends TerminalPersonalCollectionIamService<TerminalEntitlementReadView> {
  private static instance: TerminalPersonalEntitlementReadIamService;
  static getInstance() {
    return (this.instance ??= new TerminalPersonalEntitlementReadIamService());
  }
  constructor(
    iam: Pick<IamAuthorizationService, "loadPolicies" | "authorizeMany"> = IamAuthorizationService.getInstance(),
    repository: TerminalPersonalEntitlementReadStore = TerminalPersonalEntitlementReadRepository.getInstance(),
    users: Pick<IamAccountUserRepository, "targets"> = IamAccountUserRepository.getInstance(),
  ) {
    super("quyan:remote_terminal:ListMyEntitlements", iam, repository, users);
  }
}

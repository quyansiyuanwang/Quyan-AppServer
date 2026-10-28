import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { IamAccountUserRepository } from "@/store/users/iam-account-principal";
import { TerminalPersonalDeviceReadRepository } from "@/store/remote-terminal-product/terminal-personal-device-read.repository";
import type { TerminalPersonalDeviceReadStore } from "@/store/remote-terminal-product/terminal-personal-device-read.store";
import type { TerminalDeviceReadView } from "@/store/remote-terminal-product/platform-terminal-device-read.store";
import { TerminalPersonalCollectionIamService } from "./terminal-personal-collection-iam.service";
export class TerminalPersonalDeviceReadIamService extends TerminalPersonalCollectionIamService<TerminalDeviceReadView> {
  private static instance: TerminalPersonalDeviceReadIamService;
  static getInstance() {
    return (this.instance ??= new TerminalPersonalDeviceReadIamService());
  }
  constructor(
    iam: Pick<IamAuthorizationService, "loadPolicies" | "authorizeMany"> = IamAuthorizationService.getInstance(),
    repository: TerminalPersonalDeviceReadStore = TerminalPersonalDeviceReadRepository.getInstance(),
    users: Pick<IamAccountUserRepository, "targets"> = IamAccountUserRepository.getInstance(),
  ) {
    super("quyan:remote_terminal:ListMyDevices", iam, repository, users);
  }
}

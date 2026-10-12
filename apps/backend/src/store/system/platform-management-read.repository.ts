import type { IamPrincipal, Permission } from "@quyan/shared";
import { IamAccountUserRepository, iamAccountDenied } from "../users/iam-account-principal";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import type { PlatformManagementReadStore, PlatformManagementReadSnapshot } from "./platform-management-read.store";
export class PlatformManagementReadRepository implements PlatformManagementReadStore {
  private static instance: PlatformManagementReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformManagementReadRepository());
  }
  async snapshot(principal: IamPrincipal, permission: Permission) {
    const group = await platformManagementGroupSnapshot(principal, permission);
    const ids = [...new Set([principal.subjectUserId, principal.accountOwnerId])];
    const users = await IamAccountUserRepository.getInstance().targets(principal, ids);
    if (
      users.length !== ids.length ||
      ids.some(
        (id) =>
          !users.some(
            (user) => user.id === id && user.updateTime instanceof Date && Number.isFinite(user.updateTime.getTime()),
          ),
      )
    )
      throw iamAccountDenied();
    return { group, users };
  }
  async recheck(principal: IamPrincipal, permission: Permission, expected: PlatformManagementReadSnapshot) {
    const current = await this.snapshot(principal, permission);
    if (
      current.group.id !== expected.group.id ||
      current.group.updateTime.getTime() !== expected.group.updateTime.getTime() ||
      current.users.length !== expected.users.length ||
      current.users.some(
        (user) =>
          !expected.users.some(
            (previous) => previous.id === user.id && previous.updateTime.getTime() === user.updateTime.getTime(),
          ),
      )
    )
      throw iamAccountDenied();
  }
}

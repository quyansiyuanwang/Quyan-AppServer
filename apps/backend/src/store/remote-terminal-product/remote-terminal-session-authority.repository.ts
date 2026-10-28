import { captureIamAccessKeyRevision } from "../users/iam-access-key-authority";
import { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { assertIamAccountPrincipal, iamAccountDenied } from "../users/iam-account-principal";
import { RemoteTerminalDeviceReadRepository } from "./remote-terminal-device-read.repository";
import { assertTerminalDeviceTargets } from "./remote-terminal-device-snapshot";
import type { RemoteTerminalDeviceTarget } from "./remote-terminal-device-read.store";
import { isRemoteTerminalId } from "@/iam/resources/remote-terminal-resources";
export interface TerminalSessionAuthority {
  principal: IamPrincipal;
  userRevision: string;
  authenticationUpdatedAt: string;
  accessKeyId?: string;
  keyRevision?: string;
  device: RemoteTerminalDeviceTarget;
}
export interface TerminalSessionAuthorityStore {
  capture(principal: IamPrincipal, deviceId: string, accessKeyId?: string): Promise<TerminalSessionAuthority>;
  assertCurrent(authority: TerminalSessionAuthority): Promise<void>;
}
/** Never hydrate password, AccessKey material, complete device snapshots or registration tokens. */
export class RemoteTerminalSessionAuthorityRepository implements TerminalSessionAuthorityStore {
  private static instance: RemoteTerminalSessionAuthorityRepository;
  static getInstance() {
    return (this.instance ??= new RemoteTerminalSessionAuthorityRepository());
  }
  async capture(principal: IamPrincipal, deviceId: string, accessKeyId?: string): Promise<TerminalSessionAuthority> {
    if (
      !isRemoteTerminalId(deviceId) ||
      (accessKeyId !== undefined && !isRemoteTerminalId(accessKeyId)) ||
      (principal.subjectType === "access_key" && !accessKeyId)
    )
      throw iamAccountDenied();
    await assertIamAccountPrincipal(principal);
    const users = await prisma.$queryRaw<{ id: string; revision: string; updatedAt: Date }[]>(Prisma.sql`
      SELECT u.id,u.updateTime AS updatedAt,SHA2(CAST(JSON_ARRAY(u.id,u.accountOwnerId,u.status,u.updateTime) AS CHAR),256) AS revision
      FROM users u WHERE BINARY u.id=BINARY ${principal.subjectUserId} AND u.status=1
        AND (BINARY u.accountOwnerId=BINARY ${principal.accountOwnerId}
          OR (BINARY u.id=BINARY ${principal.accountOwnerId} AND u.accountOwnerId IS NULL))`);
    if (
      users.length !== 1 ||
      users[0].id !== principal.subjectUserId ||
      !(users[0].updatedAt instanceof Date) ||
      !Number.isFinite(users[0].updatedAt.getTime()) ||
      !/^[a-f0-9]{64}$/.test(users[0].revision)
    )
      throw iamAccountDenied();
    const keyRevision = await captureIamAccessKeyRevision(principal, accessKeyId);
    const targets = await RemoteTerminalDeviceReadRepository.getInstance().targets(principal, [deviceId]);
    if (targets.length !== 1 || targets[0].deviceId !== deviceId || targets[0].userId !== principal.subjectUserId)
      throw iamAccountDenied();
    return {
      principal: { ...principal },
      userRevision: users[0].revision,
      authenticationUpdatedAt: users[0].updatedAt.toISOString(),
      ...(accessKeyId ? { accessKeyId, keyRevision } : {}),
      device: { ...targets[0] },
    };
  }
  async assertCurrent(authority: TerminalSessionAuthority) {
    const current = await this.capture(authority.principal, authority.device.deviceId, authority.accessKeyId);
    if (current.userRevision !== authority.userRevision || current.keyRevision !== authority.keyRevision)
      throw iamAccountDenied();
    assertTerminalDeviceTargets([current.device], [authority.device], false);
  }
}

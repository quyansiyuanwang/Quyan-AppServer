import { mutatePlatformRelayProbeAccount } from "./platform-relay-probe-account-mutation";
import { Prisma } from "@prisma/client";
import { type IamPrincipal } from "@quyan/shared";
import { iamAccountDenied } from "../users/iam-account-principal";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
import { ConflictError, NotFoundError } from "@/util/errors";
export interface PlatformRelayProbeAccountDeleteStore {
  remove(
    id: string,
    principal: IamPrincipal,
    snapshot: PlatformManagementReadSnapshot,
    recheck: () => Promise<void>,
    persist: boolean,
  ): Promise<void>;
}
export class PlatformRelayProbeAccountDeleteRepository implements PlatformRelayProbeAccountDeleteStore {
  private static instance: PlatformRelayProbeAccountDeleteRepository;
  static getInstance() {
    return (this.instance ??= new PlatformRelayProbeAccountDeleteRepository());
  }
  async remove(
    id: string,
    principal: IamPrincipal,
    snapshot: PlatformManagementReadSnapshot,
    recheck: () => Promise<void>,
    persist: boolean,
  ) {
    await mutatePlatformRelayProbeAccount(principal, snapshot, recheck, async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_channel_probe_accounts WHERE id = ${id} FOR UPDATE`);
      const account = await tx.relayChannelProbeAccount.findUnique({ where: { id }, select: { id: true } });
      if (!account)
        throw new NotFoundError("Probe account not found", undefined, {
          messageKey: "relayChannelProbe.accountNotFound",
        });
      if (await tx.relayChannelProbeTargetConfig.count({ where: { accountId: id } }))
        throw new ConflictError("Account is still bound", undefined, {
          messageKey: "relayChannelProbe.accountStillBound",
        });
      await recheck();
      if (persist && (await tx.relayChannelProbeAccount.deleteMany({ where: { id } })).count !== 1)
        throw iamAccountDenied();
    });
  }
}

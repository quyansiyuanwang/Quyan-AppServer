import type { IamPrincipal } from "@quyan/shared";
import { mutatePlatformRelayProbeAccount } from "./platform-relay-probe-account-mutation";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
import { NotFoundError } from "@/util/errors";
import type { RelayChannelProbeAccount } from "@prisma/client";

export class RelayProbeAccountEditorRepository {
  private static instance: RelayProbeAccountEditorRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeAccountEditorRepository());
  }
  async read<T>(
    id: string,
    principal: IamPrincipal,
    snapshot: PlatformManagementReadSnapshot,
    recheck: () => Promise<void>,
    project: (account: RelayChannelProbeAccount) => T,
  ): Promise<T> {
    return mutatePlatformRelayProbeAccount(principal, snapshot, recheck, async (tx) => {
      await recheck();
      const row = await tx.relayChannelProbeAccount.findUnique({ where: { id } });
      if (!row)
        throw new NotFoundError("Probe account not found", undefined, {
          messageKey: "relayChannelProbe.accountNotFound",
        });
      const result = project(row);
      await recheck();
      return result;
    });
  }
}

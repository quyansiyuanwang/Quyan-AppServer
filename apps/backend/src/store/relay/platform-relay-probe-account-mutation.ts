import type { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
import { mutatePlatformRelayProbe } from "./platform-relay-probe-mutation";
/** Keep the existing account-management ceiling for every account mutation. */
export function mutatePlatformRelayProbeAccount<T>(
  principal: IamPrincipal,
  snapshot: PlatformManagementReadSnapshot,
  recheck: () => Promise<void>,
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return mutatePlatformRelayProbe(Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE, principal, snapshot, recheck, mutate);
}

import { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { assertIamAccountPrincipal, iamAccountDenied } from "../users/iam-account-principal";
export interface TerminalUsageTotals {
  totalTerminalLimit: number;
  totalDeviceLimit: number;
  activeDeviceCount: number;
}
export interface TerminalUsageStore {
  totals(principal: IamPrincipal): Promise<TerminalUsageTotals>;
}
/** Counts include every owned active binding, independent of per-device list visibility. */
export class RemoteTerminalUsageRepository implements TerminalUsageStore {
  private static instance: RemoteTerminalUsageRepository;
  static getInstance() {
    return (this.instance ??= new RemoteTerminalUsageRepository());
  }
  async totals(principal: IamPrincipal): Promise<TerminalUsageTotals> {
    return prisma.$transaction(
      async (tx) => {
        await assertIamAccountPrincipal(principal, tx);
        const at = new Date(),
          userId = principal.subjectUserId;
        const quotas = await tx.$queryRaw<
          { terminal: Prisma.Decimal | null; device: Prisma.Decimal | null }[]
        >(Prisma.sql`
        SELECT SUM(e.terminalLimit) AS terminal,SUM(e.deviceLimit) AS device
        FROM remote_terminal_user_entitlements e WHERE BINARY e.userId=BINARY ${userId}
          AND e.status=1 AND e.startAt<=${at} AND e.endAt>=${at}`);
        const devices = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        SELECT COUNT(*) AS count FROM remote_terminal_device_bindings b
          JOIN remote_terminal_user_entitlements e ON BINARY e.id=BINARY b.entitlementId
        WHERE BINARY b.userId=BINARY ${userId} AND BINARY e.userId=BINARY b.userId
          AND b.status=1 AND e.status=1 AND e.startAt<=${at} AND e.endAt>=${at}`);
        const result = {
          totalTerminalLimit: Number(quotas[0]?.terminal ?? 0),
          totalDeviceLimit: Number(quotas[0]?.device ?? 0),
          activeDeviceCount: Number(devices[0]?.count ?? 0),
        };
        if (Object.values(result).some((value) => !Number.isSafeInteger(value) || value < 0)) throw iamAccountDenied();
        await assertIamAccountPrincipal(principal, tx);
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

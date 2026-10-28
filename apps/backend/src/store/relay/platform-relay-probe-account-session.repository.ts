import { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
import { mutatePlatformRelayProbeAccount } from "./platform-relay-probe-account-mutation";
import { BadRequestError, NotFoundError } from "@/util/errors";
export interface ProbeAccountSessionContext {
  principal: IamPrincipal;
  snapshot: PlatformManagementReadSnapshot;
  recheck: () => Promise<void>;
}
export interface PlatformRelayProbeAccountSessionStore {
  inspect(id: string, context: ProbeAccountSessionContext): Promise<void>;
  recordAttempt(id: string, context: ProbeAccountSessionContext): Promise<void>;
  publish(id: string, context: ProbeAccountSessionContext, commit: () => Promise<void>): Promise<void>;
}
export class PlatformRelayProbeAccountSessionRepository implements PlatformRelayProbeAccountSessionStore {
  private static instance: PlatformRelayProbeAccountSessionRepository;
  static getInstance() {
    return (this.instance ??= new PlatformRelayProbeAccountSessionRepository());
  }
  private async operation(
    id: string,
    context: ProbeAccountSessionContext,
    execute: (
      tx: Prisma.TransactionClient,
      account: { lastLoginAttemptAt: Date | null; minLoginIntervalSeconds: number },
    ) => Promise<void>,
  ) {
    await mutatePlatformRelayProbeAccount(context.principal, context.snapshot, context.recheck, async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_channel_probe_accounts WHERE id = ${id} FOR UPDATE`);
      const account = await tx.relayChannelProbeAccount.findUnique({
        where: { id },
        select: { id: true, lastLoginAttemptAt: true, minLoginIntervalSeconds: true },
      });
      if (!account)
        throw new NotFoundError("Probe account not found", undefined, {
          messageKey: "relayChannelProbe.accountNotFound",
        });
      await context.recheck();
      await execute(tx, account);
    });
  }
  inspect(id: string, context: ProbeAccountSessionContext) {
    return this.operation(id, context, async () => {});
  }
  recordAttempt(id: string, context: ProbeAccountSessionContext) {
    return this.operation(id, context, async (tx, account) => {
      if (
        account.lastLoginAttemptAt &&
        Date.now() < account.lastLoginAttemptAt.getTime() + account.minLoginIntervalSeconds * 1000
      )
        throw new BadRequestError("Probe account login cooldown", undefined, {
          messageKey: "relayChannelProbe.accountLoginCooldown",
        });
      await tx.relayChannelProbeAccount.update({
        where: { id },
        data: { lastLoginAttemptAt: new Date() },
        select: { id: true },
      });
    });
  }
  publish(id: string, context: ProbeAccountSessionContext, commit: () => Promise<void>) {
    return this.operation(id, context, async () => {
      await commit();
    });
  }
}

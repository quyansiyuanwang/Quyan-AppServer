import { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import type { SaveRelayChannelProbeAccountRequest } from "@/api/dto/relay/relay-channel-probe.dto";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
import { mutatePlatformRelayProbeAccount } from "./platform-relay-probe-account-mutation";
import {
  relayProbeAccountPublicSelect,
  type RelayProbeAccountPublicRecord,
} from "./platform-relay-probe-account-read.repository";
import { NotFoundError } from "@/util/errors";
export type ProbeAccountEncryptedConfiguration = {
  encryptedCredentials: string;
  credentialIv: string;
  credentialAuthTag: string;
};
export type EncryptProbeAccountConfiguration = (
  input: SaveRelayChannelProbeAccountRequest,
  previous?: ProbeAccountEncryptedConfiguration,
) => ProbeAccountEncryptedConfiguration;
export interface PlatformRelayProbeAccountUpdateStore {
  update(
    id: string,
    input: SaveRelayChannelProbeAccountRequest,
    principal: IamPrincipal,
    snapshot: PlatformManagementReadSnapshot,
    recheck: () => Promise<void>,
    encrypt: EncryptProbeAccountConfiguration,
    persist: boolean,
  ): Promise<RelayProbeAccountPublicRecord | undefined>;
}
export class PlatformRelayProbeAccountUpdateRepository implements PlatformRelayProbeAccountUpdateStore {
  private static instance: PlatformRelayProbeAccountUpdateRepository;
  static getInstance() {
    return (this.instance ??= new PlatformRelayProbeAccountUpdateRepository());
  }
  async update(
    id: string,
    input: SaveRelayChannelProbeAccountRequest,
    principal: IamPrincipal,
    snapshot: PlatformManagementReadSnapshot,
    recheck: () => Promise<void>,
    encrypt: EncryptProbeAccountConfiguration,
    persist: boolean,
  ) {
    return mutatePlatformRelayProbeAccount(principal, snapshot, recheck, async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_channel_probe_accounts WHERE id = ${id} FOR UPDATE`);
      const target = await tx.relayChannelProbeAccount.findUnique({ where: { id }, select: { id: true } });
      if (!target)
        throw new NotFoundError("Probe account not found", undefined, {
          messageKey: "relayChannelProbe.accountNotFound",
        });
      await recheck();
      if (!persist) return undefined;
      // Replacement credentials do not require decrypting the previous secret.
      const previous = input.credentials
        ? undefined
        : await tx.relayChannelProbeAccount.findUniqueOrThrow({
            where: { id },
            select: { encryptedCredentials: true, credentialIv: true, credentialAuthTag: true },
          });
      const encrypted = encrypt(input, previous);
      const account = await tx.relayChannelProbeAccount.update({
        where: { id },
        data: {
          name: input.name,
          tokenPath: input.tokenPath,
          expiresPath: input.expiresPath ?? null,
          expiresMode: input.expiresMode ?? null,
          fallbackTtlSeconds: input.fallbackTtlSeconds,
          minLoginIntervalSeconds: input.minLoginIntervalSeconds,
          ...encrypted,
        },
        select: relayProbeAccountPublicSelect,
      });
      return { ...account, hasCredentials: Boolean(encrypted.encryptedCredentials) };
    });
  }
}

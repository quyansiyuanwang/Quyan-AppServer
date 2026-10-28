import type { IamPrincipal } from "@quyan/shared";
import type { SaveRelayChannelProbeAccountRequest } from "@/api/dto/relay/relay-channel-probe.dto";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
import { mutatePlatformRelayProbeAccount } from "./platform-relay-probe-account-mutation";
import {
  relayProbeAccountPublicSelect,
  type RelayProbeAccountPublicRecord,
} from "./platform-relay-probe-account-read.repository";
import type { EncryptProbeAccountConfiguration } from "./platform-relay-probe-account-update.repository";
import { iamAccountDenied } from "../users/iam-account-principal";
export interface PlatformRelayProbeAccountCreateStore {
  create(
    id: string,
    input: SaveRelayChannelProbeAccountRequest,
    principal: IamPrincipal,
    snapshot: PlatformManagementReadSnapshot,
    recheck: () => Promise<void>,
    encrypt: EncryptProbeAccountConfiguration,
    persist: boolean,
  ): Promise<RelayProbeAccountPublicRecord | undefined>;
}
export class PlatformRelayProbeAccountCreateRepository implements PlatformRelayProbeAccountCreateStore {
  private static instance: PlatformRelayProbeAccountCreateRepository;
  static getInstance() {
    return (this.instance ??= new PlatformRelayProbeAccountCreateRepository());
  }
  async create(
    id: string,
    input: SaveRelayChannelProbeAccountRequest,
    principal: IamPrincipal,
    snapshot: PlatformManagementReadSnapshot,
    recheck: () => Promise<void>,
    encrypt: EncryptProbeAccountConfiguration,
    persist: boolean,
  ) {
    return mutatePlatformRelayProbeAccount(principal, snapshot, recheck, async (tx) => {
      await recheck();
      if (!persist) return undefined;
      const encrypted = encrypt(input);
      const account = await tx.relayChannelProbeAccount.create({
        data: {
          ...encrypted,
          id,
          name: input.name,
          tokenPath: input.tokenPath,
          expiresPath: input.expiresPath ?? null,
          expiresMode: input.expiresMode ?? null,
          fallbackTtlSeconds: input.fallbackTtlSeconds,
          minLoginIntervalSeconds: input.minLoginIntervalSeconds,
        },
        select: relayProbeAccountPublicSelect,
      });
      if (account.id !== id) throw iamAccountDenied();
      return { ...account, hasCredentials: Boolean(encrypted.encryptedCredentials) };
    });
  }
}

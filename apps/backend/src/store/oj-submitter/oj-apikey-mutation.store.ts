import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import type { RelayChannelSelectionMetadata } from "../relay/relay-channel.store";
import type { OjApiKeyTarget, OjApiKeyView } from "./oj-apikey-management.store";
export interface OjApiKeyUpdateInput {
  name?: string;
  expiresAt?: Date | null;
  channelId?: string | null;
}
export interface OjApiKeyUpdateGuard {
  identity: IamAccountUserMutationGuard;
  target: OjApiKeyTarget;
  channel?: RelayChannelSelectionMetadata;
  canReveal: () => Promise<boolean>;
}
export interface OjApiKeyCreateInput {
  userId: string;
  key: string;
  name?: string;
  expiresAt?: Date;
  channelId?: string;
}
export interface OjApiKeyCreateGuard {
  identity: IamAccountUserMutationGuard;
  channel?: RelayChannelSelectionMetadata;
}
export interface OjApiKeyMutationStore {
  create(data: OjApiKeyCreateInput, guard: OjApiKeyCreateGuard): Promise<OjApiKeyView & { key: string }>;

  update(data: OjApiKeyUpdateInput, guard: OjApiKeyUpdateGuard): Promise<OjApiKeyView>;
}

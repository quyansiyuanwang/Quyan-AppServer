import type { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import type { RelayModelRateInput } from "./relay-config.store";
import type { RelayConfigDto } from "@/api/dto/relay/relay-config.dto";
export interface RelayConfigurationWriteMetadata {
  id: string;
  status: number;
  createTime: Date;
  updateTime: Date;
  revision: string;
}
export interface RelayConfigurationWriteTarget {
  config: (RelayConfigurationWriteMetadata & { channelTopologyMode: string }) | null;
  prices: readonly (RelayConfigurationWriteMetadata & { model: string })[];
}
export interface RelayConfigurationWriteGuard {
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
  authorizationRevision: string;
  requireResources: (resources: readonly string[]) => Promise<void>;
  readablePricingIds: (ids: readonly string[]) => Promise<ReadonlySet<string>>;
}
export interface PlatformRelayConfigurationWriteStore {
  authorizationRevision(principal: IamPrincipal): Promise<string>;
  prepare(models?: readonly string[]): Promise<RelayConfigurationWriteTarget>;
  write(
    target: RelayConfigurationWriteTarget,
    data: Prisma.RelayConfigUncheckedCreateInput,
    rates: readonly RelayModelRateInput[] | undefined,
    guard: RelayConfigurationWriteGuard,
  ): Promise<RelayConfigDto & { id: string }>;
}

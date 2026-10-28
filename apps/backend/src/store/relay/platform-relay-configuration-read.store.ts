import type { ModelPricing, RelayConfig } from "@prisma/client";
import type { PlatformCollectionStore, PlatformCollectionTarget } from "../system/platform-collection.store";
export interface RelayConfigurationReadTarget extends PlatformCollectionTarget {
  source: "config" | "pricing";
  recordId: string | null;
  revision: string;
}
export interface RelayConfigurationReadWhere {
  cutoff: Date;
}
export interface PlatformRelayConfigurationReadStore
  extends PlatformCollectionStore<
    RelayConfigurationReadWhere,
    RelayConfigurationReadWhere,
    RelayConfigurationReadTarget
  > {
  hydrateConfiguration(target: RelayConfigurationReadTarget): Promise<RelayConfig | null>;
  hydratePricing(targets: readonly RelayConfigurationReadTarget[]): Promise<ModelPricing[]>;
}

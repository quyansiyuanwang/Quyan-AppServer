import type { ContentSafetyRule } from "@prisma/client";
import type { PlatformCollectionStore, PlatformCollectionTarget } from "./platform-collection.store";
export interface ContentSafetySystemRuleTarget extends PlatformCollectionTarget {
  priority: number;
  revision: string;
}
export interface ContentSafetySystemConfiguration {
  values: Record<string, string>;
  revision: string;
}
export interface ContentSafetySystemReadStore
  extends PlatformCollectionStore<void, true, ContentSafetySystemRuleTarget> {
  hydrate(targets: readonly ContentSafetySystemRuleTarget[]): Promise<ContentSafetyRule[]>;
  configuration(): Promise<ContentSafetySystemConfiguration>;
}

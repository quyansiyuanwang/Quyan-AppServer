import type { RelayConfig } from "@prisma/client";
import type { RelayConfigurationReadTarget } from "./platform-relay-configuration-read.store";
import type { RelayConcurrencyKeyTarget } from "@/util/relay-concurrency-status-projection";
export interface RelayConcurrencyUserTarget {
  id: string;
  accountOwnerId: string | null;
  status: number;
  createTime: Date;
  updateTime: Date;
}
export interface PlatformRelayConcurrencyReadStore {
  configurationTarget(): Promise<RelayConfigurationReadTarget>;
  hydrateConfiguration(target: RelayConfigurationReadTarget): Promise<RelayConfig | null>;
  users(ids: readonly string[]): Promise<RelayConcurrencyUserTarget[]>;
  scan(
    scope: "default" | "image",
    kind: "slot" | "waiter",
    userId?: string,
    cursor?: string,
  ): Promise<{ cursor: string; keys: RelayConcurrencyKeyTarget[] }>;
  ttl(key: string): Promise<number>;
}

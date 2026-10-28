import type { Group, MonthlyPassTemplate, ModelPricing, RelayChannel } from "@prisma/client";
import type { PlatformCollectionCursor, PlatformCollectionTarget } from "../system/platform-collection.store";
export type MonthlyPassFilterKind = "template" | "model" | "channel" | "group";
export const MONTHLY_PASS_FILTER_KINDS: readonly MonthlyPassFilterKind[] = ["template", "model", "channel", "group"];
export interface MonthlyPassFilterTarget extends PlatformCollectionTarget {
  revision: string;
}
export interface MonthlyPassFilterScope {
  groupId: string;
  minGroupLevel: number;
}
export type MonthlyPassFilterRecord =
  | ({ kind: "template" } & Pick<MonthlyPassTemplate, "id" | "name" | "status" | "publishStatus">)
  | ({ kind: "model" } & Pick<ModelPricing, "id" | "model" | "status">)
  | ({ kind: "channel" } & Pick<RelayChannel, "id" | "name" | "status" | "visibilityMode" | "visibilityConfig">)
  | ({ kind: "group" } & Pick<Group, "id" | "name" | "username" | "status">);
export interface MonthlyPassFilterOptionsStore {
  scope(groupId: string): Promise<MonthlyPassFilterScope>;
  scan(
    kind: MonthlyPassFilterKind,
    scope: MonthlyPassFilterScope,
    after?: PlatformCollectionCursor,
    boundary?: PlatformCollectionCursor,
  ): Promise<MonthlyPassFilterTarget[]>;
  hydrate(
    kind: MonthlyPassFilterKind,
    scope: MonthlyPassFilterScope,
    targets: readonly MonthlyPassFilterTarget[],
  ): Promise<MonthlyPassFilterRecord[]>;
  verify(
    kind: MonthlyPassFilterKind,
    scope: MonthlyPassFilterScope,
    targets: readonly MonthlyPassFilterTarget[],
  ): Promise<void>;
}

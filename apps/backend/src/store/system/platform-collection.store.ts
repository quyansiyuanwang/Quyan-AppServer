export interface PlatformCollectionTarget {
  id: string;
  status: number;
  createTime: Date;
  updateTime: Date;
}
export type PlatformCollectionCursor = Pick<PlatformCollectionTarget, "id" | "createTime">;
export interface PlatformCollectionStore<
  Filters,
  Where,
  Target extends PlatformCollectionTarget = PlatformCollectionTarget,
> {
  where(filters: Filters): Promise<Where | null | undefined>;
  scan(where: Where, after?: PlatformCollectionCursor, boundary?: PlatformCollectionCursor): Promise<Target[]>;
}

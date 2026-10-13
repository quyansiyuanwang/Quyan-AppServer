export interface PlatformLogTarget {
  id: string;
  status: number;
  createTime: Date;
  updateTime: Date;
}
export type PlatformLogCursor = Pick<PlatformLogTarget, "id" | "createTime">;
export interface PlatformLogCollectionStore<Filters, Where> {
  where(filters: Filters): Promise<Where | null | undefined>;
  scan(where: Where, after?: PlatformLogCursor, boundary?: PlatformLogCursor): Promise<PlatformLogTarget[]>;
}

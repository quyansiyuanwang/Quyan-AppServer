export interface HeatPointInput {
  pointType: "click" | "scroll_stop";
  page: string;
  xRatio: number;
  yRatio: number;
  scrollDepth: number;
  viewportW: number;
  viewportH: number;
  sessionId?: string;
  timestamp: number;
}

export interface BatchHeatmapBody {
  points: HeatPointInput[];
}

export interface HeatmapQuery {
  page: string;
  pointType: "click" | "scroll_stop";
  startTime: number;
  endTime: number;
}

export interface AggregatedHeatPoint {
  xRatio: number;
  yRatio: number;
  count: number;
}

export interface HeatmapQueryResponse {
  points: AggregatedHeatPoint[];
}

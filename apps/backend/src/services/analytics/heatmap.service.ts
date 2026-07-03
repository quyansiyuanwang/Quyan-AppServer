import { HeatmapPointRepository } from "@/store/analytics/heatmap-point.repository";
import type { HeatPointInput, HeatmapQuery, HeatmapQueryResponse } from "@/api/dto/analytics/heatmap.dto";

class HeatmapService {
  private static instance: HeatmapService;

  private constructor(private readonly repository: HeatmapPointRepository = HeatmapPointRepository.getInstance()) {}

  public static getInstance(): HeatmapService {
    if (!HeatmapService.instance) HeatmapService.instance = new HeatmapService();
    return HeatmapService.instance;
  }

  async batchCollect(points: HeatPointInput[]): Promise<void> {
    if (points.length === 0) return;
    await this.repository.batchCreate(points);
  }

  async query(query: HeatmapQuery): Promise<HeatmapQueryResponse> {
    const points = await this.repository.queryAggregated(query);
    return { points };
  }
}

export default HeatmapService;

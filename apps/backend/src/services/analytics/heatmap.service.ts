import { PlatformManagementReadIamService } from "@/services/system/platform-management-read-iam.service";
import { platformSystemArn } from "@/iam/resources/platform-system-resources";
import type { TypedRequest } from "@/types/express";
import { HeatmapPointRepository } from "@/store/analytics/heatmap-point.repository";
import type { HeatPointInput, HeatmapQuery, HeatmapQueryResponse } from "@/api/dto/analytics/heatmap.dto";

class HeatmapService {
  private static instance: HeatmapService;

  private constructor(
    private readonly repository: HeatmapPointRepository = HeatmapPointRepository.getInstance(),
    private readonly iamReads = PlatformManagementReadIamService.getInstance(),
  ) {}

  public static getInstance(): HeatmapService {
    if (!HeatmapService.instance) HeatmapService.instance = new HeatmapService();
    return HeatmapService.instance;
  }

  async batchCollect(points: HeatPointInput[]): Promise<void> {
    if (points.length === 0) return;
    await this.repository.batchCreate(points);
  }

  async queryManaged(query: HeatmapQuery, request: TypedRequest): Promise<HeatmapQueryResponse> {
    return this.iamReads.read("quyan:analytics:GetHeatmap", platformSystemArn("heatmap-stats"), request, () =>
      this.query(query),
    );
  }
  async query(query: HeatmapQuery): Promise<HeatmapQueryResponse> {
    const points = await this.repository.queryAggregated(query);
    return { points };
  }
}

export default HeatmapService;

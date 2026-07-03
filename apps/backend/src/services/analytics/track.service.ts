import { TrackEventRepository } from "@/store/analytics/track-event.repository";
import type {
  TrackEventInput,
  TrackStatsQuery,
  TrackStatsResponse,
  FunnelQuery,
  FunnelResponse,
} from "@/api/dto/analytics/track.dto";

class TrackService {
  private static instance: TrackService;

  private constructor(private readonly repository: TrackEventRepository = TrackEventRepository.getInstance()) {}

  public static getInstance(): TrackService {
    if (!TrackService.instance) TrackService.instance = new TrackService();
    return TrackService.instance;
  }

  async batchTrack(events: TrackEventInput[], ip: string): Promise<void> {
    const valid = events.filter((e) => e.name && typeof e.clientTime === "number" && e.sessionId && e.deviceInfo);
    if (valid.length === 0) return;
    await this.repository.batchCreate(valid, ip);
  }

  async getStats(query: TrackStatsQuery): Promise<TrackStatsResponse> {
    return this.repository.getStats(query);
  }

  async getFunnel(query: FunnelQuery): Promise<FunnelResponse> {
    const steps = await this.repository.getFunnelStats(query.steps, query.startTime, query.endTime);
    return { steps };
  }
}

export default TrackService;

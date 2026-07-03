import { useRequestStore } from '@/stores/request'
import { createTrackControllerApi } from '@/client/services/track-controller.gen'
import { createHeatmapControllerApi } from '@/client/services/heatmap-controller.gen'
import { cacheObject } from '@/utils/common'

export type {
  PvItem,
  TopEvent,
  TimelineItem,
  TrackStatsQuery,
  FunnelQuery,
  FunnelStep,
  HeatmapQuery,
  AggregatedHeatPoint,
  HeatmapQueryResponse,
  BatchTrackBody,
  BatchHeatmapBody,
} from '@/client/types.gen'

import type {
  TrackStatsQuery,
  FunnelQuery,
  HeatmapQuery,
  TrackControllerGetStatsResponse,
  TrackControllerGetFunnelResponse,
  HeatmapControllerQueryResponse,
} from '@/client/types.gen'

const trackApi = cacheObject(() => createTrackControllerApi(useRequestStore().getAxios()))
const heatmapApi = cacheObject(() => createHeatmapControllerApi(useRequestStore().getAxios()))

export type TrackStatsResponse = TrackControllerGetStatsResponse
export type FunnelResponse = TrackControllerGetFunnelResponse

export const analyticsService = {
  async getStats(query: TrackStatsQuery): Promise<TrackControllerGetStatsResponse> {
    return (await trackApi.getStats({ body: query })).data
  },

  async getFunnel(query: FunnelQuery): Promise<TrackControllerGetFunnelResponse> {
    return (await trackApi.getFunnel({ body: query })).data
  },

  async queryHeatmap(query: HeatmapQuery): Promise<HeatmapControllerQueryResponse> {
    return (await heatmapApi.query({ body: query })).data
  },
}

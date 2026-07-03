export interface TrackDeviceInfo {
  ua: string;
  screenW: number;
  screenH: number;
  language: string;
}

export interface TrackEventInput {
  eventType: string;
  name: string;
  page: string;
  element?: string;
  label?: string;
  properties?: Record<string, unknown>;
  sessionId: string;
  userId?: string;
  clientTime: number;
  deviceInfo: TrackDeviceInfo;
}

export interface BatchTrackBody {
  events: TrackEventInput[];
}

export interface TrackStatsQuery {
  startTime: number;
  endTime: number;
  page?: string;
  eventType?: string;
}

export interface PvItem {
  page: string;
  count: number;
}

export interface TopEvent {
  name: string;
  count: number;
}

export interface TimelineItem {
  date: string;
  count: number;
}

export interface TrackStatsResponse {
  pvList: PvItem[];
  uvCount: number;
  topEvents: TopEvent[];
  timeline: TimelineItem[];
}

export interface FunnelQuery {
  steps: string[];
  startTime: number;
  endTime: number;
}

export interface FunnelStep {
  name: string;
  users: number;
  rate: number;
}

export interface FunnelResponse {
  steps: FunnelStep[];
}

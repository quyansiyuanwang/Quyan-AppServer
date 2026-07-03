import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import type { TrackEventInput, TrackStatsResponse, FunnelStep } from "@/api/dto/analytics/track.dto";
import { RECORD_STATUS } from "@/constant/status";

export class TrackEventRepository {
  private static instance: TrackEventRepository;

  public static getInstance(): TrackEventRepository {
    if (!TrackEventRepository.instance) TrackEventRepository.instance = new TrackEventRepository();
    return TrackEventRepository.instance;
  }

  async batchCreate(events: TrackEventInput[], ip: string): Promise<void> {
    const now = BigInt(Date.now());
    await prisma.trackEvent.createMany({
      data: events.map((e) => ({
        eventType: e.eventType,
        name: e.name,
        page: e.page,
        element: e.element,
        label: e.label,
        properties: e.properties !== undefined ? (e.properties as Prisma.InputJsonValue) : undefined,
        sessionId: e.sessionId,
        userId: e.userId,
        clientTime: BigInt(e.clientTime),
        serverTime: now,
        ua: e.deviceInfo.ua,
        screenW: e.deviceInfo.screenW,
        screenH: e.deviceInfo.screenH,
        language: e.deviceInfo.language,
        ip,
      })),
    });
  }

  async getStats(query: {
    startTime: number;
    endTime: number;
    page?: string;
    eventType?: string;
  }): Promise<TrackStatsResponse> {
    const where = {
      status: RECORD_STATUS.ACTIVE,
      serverTime: { gte: BigInt(query.startTime), lte: BigInt(query.endTime) },
      ...(query.page && { page: query.page }),
      ...(query.eventType && { eventType: query.eventType }),
    };

    // PV per page — aggregate in MySQL via groupBy
    const pvRaw = await prisma.trackEvent.groupBy({
      by: ["page"],
      where,
      _count: { page: true },
      orderBy: { _count: { page: "desc" } },
    });

    // UV — COUNT DISTINCT sessionId
    const uvRaw = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT sessionId) AS count
      FROM track_events
      WHERE status = ${RECORD_STATUS.ACTIVE}
        AND serverTime >= ${BigInt(query.startTime)}
        AND serverTime <= ${BigInt(query.endTime)}
        ${query.page ? Prisma.sql`AND page = ${query.page}` : Prisma.empty}
        ${query.eventType ? Prisma.sql`AND eventType = ${query.eventType}` : Prisma.empty}
    `;

    // Top 10 events
    const eventRaw = await prisma.trackEvent.groupBy({
      by: ["name"],
      where,
      _count: { name: true },
      orderBy: { _count: { name: "desc" } },
      take: 10,
    });

    // Timeline by day
    const timelineRaw = await prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
      SELECT DATE(createTime) AS date, COUNT(*) AS count
      FROM track_events
      WHERE status = ${RECORD_STATUS.ACTIVE}
        AND serverTime >= ${BigInt(query.startTime)}
        AND serverTime <= ${BigInt(query.endTime)}
        ${query.page ? Prisma.sql`AND page = ${query.page}` : Prisma.empty}
        ${query.eventType ? Prisma.sql`AND eventType = ${query.eventType}` : Prisma.empty}
      GROUP BY DATE(createTime)
      ORDER BY date ASC
    `;

    return {
      pvList: pvRaw.map((p) => ({ page: p.page, count: p._count.page })),
      uvCount: Number(uvRaw[0]?.count ?? 0),
      topEvents: eventRaw.map((e) => ({ name: e.name, count: e._count.name })),
      timeline: timelineRaw.map((t) => ({ date: t.date, count: Number(t.count) })),
    };
  }

  async getFunnelStats(steps: string[], startTime: number, endTime: number): Promise<FunnelStep[]> {
    const rows = await prisma.trackEvent.findMany({
      where: {
        status: RECORD_STATUS.ACTIVE,
        serverTime: { gte: BigInt(startTime), lte: BigInt(endTime) },
        name: { in: steps },
      },
      select: { name: true, sessionId: true, serverTime: true },
      orderBy: [{ sessionId: "asc" }, { serverTime: "asc" }],
    });

    // Group events by session (already sorted by serverTime)
    const sessionEvents = new Map<string, string[]>();
    for (const row of rows) {
      const events = sessionEvents.get(row.sessionId) ?? [];
      events.push(row.name);
      sessionEvents.set(row.sessionId, events);
    }

    // Sequential funnel: each session must pass through steps[0] → steps[1] → ...
    const stepCounts = new Array(steps.length).fill(0);

    for (const [, events] of sessionEvents) {
      let stepIndex = 0;
      for (const eventName of events)
        if (eventName === steps[stepIndex]) {
          stepCounts[stepIndex]++;
          stepIndex++;
          if (stepIndex >= steps.length) break;
        }
    }

    const result: FunnelStep[] = [];
    let prevCount: number | null = null;

    for (let i = 0; i < steps.length; i++) {
      const count = stepCounts[i];
      const rate = prevCount === null ? 100 : prevCount === 0 ? 0 : Math.round((count / prevCount) * 10000) / 100;
      result.push({ name: steps[i], users: count, rate });
      prevCount = count;
    }

    return result;
  }
}

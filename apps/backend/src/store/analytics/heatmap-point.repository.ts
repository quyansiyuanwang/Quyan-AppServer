import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import type { HeatPointInput, HeatmapQuery, AggregatedHeatPoint } from "@/api/dto/analytics/heatmap.dto";
import { RECORD_STATUS } from "@/constant/status";

export class HeatmapPointRepository {
  private static instance: HeatmapPointRepository;

  public static getInstance(): HeatmapPointRepository {
    if (!HeatmapPointRepository.instance) HeatmapPointRepository.instance = new HeatmapPointRepository();
    return HeatmapPointRepository.instance;
  }

  async batchCreate(points: HeatPointInput[]): Promise<void> {
    const now = BigInt(Date.now());
    const valid = points.filter((p) => p.xRatio >= 0 && p.xRatio <= 1 && p.yRatio >= 0 && p.yRatio <= 1);
    if (valid.length === 0) return;

    await prisma.heatmapPoint.createMany({
      data: valid.map((p) => ({
        pointType: p.pointType,
        page: p.page,
        xRatio: new Prisma.Decimal(p.xRatio),
        yRatio: new Prisma.Decimal(p.yRatio),
        scrollDepth: p.scrollDepth,
        viewportW: p.viewportW,
        viewportH: p.viewportH,
        sessionId: p.sessionId,
        serverTime: now,
      })),
    });
  }

  async queryAggregated(query: HeatmapQuery): Promise<AggregatedHeatPoint[]> {
    // Use raw query for ROUND(..., 2) GROUP BY aggregation
    const rows = await prisma.$queryRaw<{ xRatio: number; yRatio: number; count: bigint }[]>`
      SELECT
        ROUND(xRatio, 2) AS xRatio,
        ROUND(yRatio, 2) AS yRatio,
        COUNT(*) AS count
      FROM heatmap_points
      WHERE
        page = ${query.page}
        AND pointType = ${query.pointType}
        AND serverTime >= ${BigInt(query.startTime)}
        AND serverTime <= ${BigInt(query.endTime)}
        AND status = ${RECORD_STATUS.ACTIVE}
      GROUP BY ROUND(xRatio, 2), ROUND(yRatio, 2)
      ORDER BY count DESC
      LIMIT 2000
    `;

    return rows.map((r) => ({
      xRatio: Number(r.xRatio),
      yRatio: Number(r.yRatio),
      count: Number(r.count),
    }));
  }
}

import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/services/system/platform-management-read-iam.service", () => ({
  PlatformManagementReadIamService: { getInstance: vi.fn() },
}));
vi.mock("@/store/analytics/track-event.repository", () => ({ TrackEventRepository: { getInstance: vi.fn() } }));
vi.mock("@/store/analytics/heatmap-point.repository", () => ({ HeatmapPointRepository: { getInstance: vi.fn() } }));
import TrackService from "@/services/analytics/track.service";
import HeatmapService from "@/services/analytics/heatmap.service";
import { Permission, getIamActionDefinition } from "@quyan/shared";
import { platformSystemArn } from "@/iam/resources/platform-system-resources";
import {
  platformTrackingStatisticsResource,
  platformFunnelStatisticsResource,
  platformHeatmapResource,
} from "@/iam/request/platform-system-resource-resolvers";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const query = { startTime: 1, endTime: 2 },
  funnel = { ...query, steps: ["visit", "buy"] },
  heatQuery = { ...query, page: "/fixture", pointType: "click" as const };
let tracks: TrackService, heatmaps: HeatmapService, repo: any, iam: any, request: TypedRequest;
beforeEach(() => {
  repo = {
    getStats: vi.fn().mockResolvedValue({ uvCount: 2 }),
    getFunnelStats: vi.fn().mockResolvedValue([{ name: "visit", users: 2, rate: 100 }]),
    queryAggregated: vi.fn().mockResolvedValue([{ xRatio: 0.1, yRatio: 0.2, count: 2 }]),
    batchCreate: vi.fn(),
  };
  iam = { read: vi.fn().mockImplementation(async (_a, _r, _q, read) => read()) };
  tracks = new (TrackService as unknown as new (...args: any[]) => TrackService)(repo, iam);
  heatmaps = new (HeatmapService as unknown as new (...args: any[]) => HeatmapService)(repo, iam);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*", "x-account-id": "foreign" },
  } as unknown as TypedRequest;
});
describe("platform analytics report authorization", () => {
  it("authorizes each server-declared report and executes its aggregate once", async () => {
    expect(await tracks.getManagedStats(query, request)).toEqual({ uvCount: 2 });
    expect(await tracks.getManagedFunnel(funnel, request)).toEqual({ steps: [{ name: "visit", users: 2, rate: 100 }] });
    expect(await heatmaps.queryManaged(heatQuery, request)).toEqual({
      points: [{ xRatio: 0.1, yRatio: 0.2, count: 2 }],
    });
    expect(iam.read.mock.calls.map((c: any) => [c[0], c[1], c[2]])).toEqual([
      ["quyan:analytics:GetTrackingStatistics", platformSystemArn("tracking-stats"), request],
      ["quyan:analytics:GetFunnelStatistics", platformSystemArn("tracking-funnel"), request],
      ["quyan:analytics:GetHeatmap", platformSystemArn("heatmap-stats"), request],
    ]);
    expect(repo.getStats).toHaveBeenCalledOnce();
    expect(repo.getFunnelStats).toHaveBeenCalledOnce();
    expect(repo.queryAggregated).toHaveBeenCalledOnce();
  });
  it("does not query persisted analytics after initial authorization failure", async () => {
    iam.read.mockRejectedValue(new Error("fixture deny"));
    await expect(tracks.getManagedStats(query, request)).rejects.toThrow("fixture deny");
    await expect(tracks.getManagedFunnel(funnel, request)).rejects.toThrow("fixture deny");
    await expect(heatmaps.queryManaged(heatQuery, request)).rejects.toThrow("fixture deny");
    expect(repo.getStats).not.toHaveBeenCalled();
    expect(repo.getFunnelStats).not.toHaveBeenCalled();
    expect(repo.queryAggregated).not.toHaveBeenCalled();
  });
  it("withholds aggregates if authorization is revoked after a query", async () => {
    iam.read.mockImplementation(async (_a: any, _r: any, _q: any, read: any) => {
      await read();
      throw new Error("fixture revoked");
    });
    await expect(tracks.getManagedStats(query, request)).rejects.toThrow("fixture revoked");
    await expect(heatmaps.queryManaged(heatQuery, request)).rejects.toThrow("fixture revoked");
    expect(repo.getStats).toHaveBeenCalledOnce();
    expect(repo.queryAggregated).toHaveBeenCalledOnce();
  });
  it("keeps anonymous collection independent of report grants", async () => {
    await tracks.batchTrack(
      [{ name: "visit", clientTime: 1, sessionId: "fixture", deviceInfo: {} } as any],
      "192.0.2.1",
    );
    await heatmaps.batchCollect([{ page: "/fixture", xRatio: 0.1, yRatio: 0.2 } as any]);
    expect(repo.batchCreate).toHaveBeenCalledTimes(2);
    expect(iam.read).not.toHaveBeenCalled();
  });
  it("registers fixed endpoint metadata and resources independent of the supplied filter", async () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFilesAtPaths([
      "src/api/controllers/v1/analytics/track.controller.ts",
      "src/api/controllers/v1/analytics/heatmap.controller.ts",
    ]);
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    for (const [route, operation, id, resolver] of [
      ["POST /v1/track/stats", "GetTrackingStatistics", "tracking-stats", platformTrackingStatisticsResource],
      ["POST /v1/track/funnel", "GetFunnelStatistics", "tracking-funnel", platformFunnelStatisticsResource],
      ["POST /v1/heatmap/query", "GetHeatmap", "heatmap-stats", platformHeatmapResource],
    ] as const) {
      expect(routes.find((r) => r.key === route)).toMatchObject({
        coverage: "explicit",
        actions: ["quyan:analytics:" + operation],
        issues: [],
      });
      expect(await resolver({ request, principal })).toBe(platformSystemArn(id));
      expect(getIamActionDefinition("quyan:analytics:" + operation)).toMatchObject({
        authorizationBoundary: "platform",
        legacyPermission: Permission.ANALYTICS_READ,
        resourceTypes: ["platform/system"],
      });
    }
    expect(
      routes
        .filter((r) => r.coverage === "public")
        .map((r) => r.key)
        .sort(),
    ).toEqual(["POST /v1/heatmap/collect", "POST /v1/track/batch"]);
  });
});

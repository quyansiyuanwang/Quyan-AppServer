import { prisma } from "@/config/database";
import type { Prisma } from "@prisma/client";

export type RelayChannelProbeProfileRecord = Prisma.RelayChannelProbeProfileGetPayload<{
  include: { relayChannel: true };
}>;
export type RelayChannelProbeRunRecord = Prisma.RelayChannelProbeRunGetPayload<Record<string, never>>;
export type RelayChannelProbeClaimCandidate = Prisma.RelayChannelProbeRunGetPayload<{
  include: { profile: { select: { probeGroup: true } } };
}>;
export type RelayChannelProbeRunWithChannelRecord = Prisma.RelayChannelProbeRunGetPayload<{
  include: { relayChannel: true };
}>;

/** Persistence boundary for channel balance probe profiles and queued runs. */
export class RelayChannelProbeRepository {
  private static instance: RelayChannelProbeRepository;

  public static getInstance(): RelayChannelProbeRepository {
    if (!this.instance) this.instance = new RelayChannelProbeRepository();
    return this.instance;
  }

  public listProfiles(channelIds: string[]) {
    if (!channelIds.length) return Promise.resolve([]);
    return prisma.relayChannelProbeProfile.findMany({ where: { relayChannelId: { in: channelIds } } });
  }

  public listLatestRuns(channelIds: string[]) {
    if (!channelIds.length) return Promise.resolve([]);
    return prisma.relayChannelProbeRun.findMany({
      where: { relayChannelId: { in: channelIds } },
      orderBy: { createTime: "desc" },
      distinct: ["relayChannelId"],
    });
  }

  public findProfile(channelId: string) {
    return prisma.relayChannelProbeProfile.findUnique({ where: { relayChannelId: channelId } });
  }

  public findProfileWithChannel(channelId: string): Promise<RelayChannelProbeProfileRecord | null> {
    return prisma.relayChannelProbeProfile.findUnique({
      where: { relayChannelId: channelId },
      include: { relayChannel: true },
    });
  }

  public upsertProfile(data: Prisma.RelayChannelProbeProfileUpsertArgs) {
    return prisma.relayChannelProbeProfile.upsert(data);
  }

  /** Copies an already encrypted profile without ever decrypting its credentials for a caller. */
  public copyProfile(source: RelayChannelProbeProfileRecord, targetChannelId: string) {
    const data = {
      enabled: source.enabled,
      probeFormat: source.probeFormat,
      probeEndpoint: source.probeEndpoint,
      probeModel: source.probeModel,
      probePayload: source.probePayload as Prisma.InputJsonValue,
      preventCache: source.preventCache,
      cacheMode: source.cacheMode,
      sampleCount: source.sampleCount,
      upstreamCurrency: source.upstreamCurrency,
      localCurrency: source.localCurrency,
      upstreamBalanceDivisor: source.upstreamBalanceDivisor,
      upstreamRateMultiplier: source.upstreamRateMultiplier,
      probeGroup: source.probeGroup,
      distributionMultiplier: source.distributionMultiplier,
      workflow: source.workflow as Prisma.InputJsonValue,
      encryptedCredentials: source.encryptedCredentials,
      credentialIv: source.credentialIv,
      credentialAuthTag: source.credentialAuthTag,
    };
    return prisma.relayChannelProbeProfile.upsert({
      where: { relayChannelId: targetChannelId },
      create: { relayChannelId: targetChannelId, ...data },
      update: data,
    });
  }

  public deleteProfile(channelId: string) {
    return prisma.relayChannelProbeProfile.delete({ where: { relayChannelId: channelId } });
  }

  public findActiveRun(channelId: string) {
    return prisma.relayChannelProbeRun.findFirst({
      where: { relayChannelId: channelId, status: { in: ["queued", "running"] } },
    });
  }

  public createRun(data: Prisma.RelayChannelProbeRunUncheckedCreateInput) {
    return prisma.relayChannelProbeRun.create({ data });
  }

  public async listRuns(channelId: string, page: number, pageSize: number) {
    const where = { relayChannelId: channelId };
    const [total, items] = await prisma.$transaction([
      prisma.relayChannelProbeRun.count({ where }),
      prisma.relayChannelProbeRun.findMany({
        where,
        orderBy: { createTime: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, items };
  }

  /** Never removes queued/running work; emergency state reset owns those states. */
  public clearRunHistory(channelId: string, scope: "all" | "failed"): Promise<{ count: number }> {
    const statuses =
      scope === "failed" ? ["failed", "timed_out", "cancelled"] : ["succeeded", "failed", "timed_out", "cancelled"];
    return prisma.relayChannelProbeRun.deleteMany({
      where: { relayChannelId: channelId, status: { in: statuses } },
    });
  }

  public findRunsWithChannels(runIds: string[]): Promise<RelayChannelProbeRunWithChannelRecord[]> {
    return prisma.relayChannelProbeRun.findMany({ where: { id: { in: runIds } }, include: { relayChannel: true } });
  }

  public async applySuggestedMultiplier(params: {
    runId: string;
    channelId: string;
    expectedMultiplier: Prisma.Decimal | number;
    suggestedMultiplier: Prisma.Decimal | number;
    actorUserId: string;
  }): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const changed = await tx.relayChannel.updateMany({
        where: { id: params.channelId, multiplier: params.expectedMultiplier },
        data: { multiplier: params.suggestedMultiplier },
      });
      if (!changed.count) return false;
      const applied = await tx.relayChannelProbeRun.updateMany({
        where: { id: params.runId, appliedAt: null },
        data: {
          appliedMultiplier: params.suggestedMultiplier,
          appliedAt: new Date(),
          appliedByUserId: params.actorUserId,
        },
      });
      if (applied.count) return true;
      throw new Error("Probe run was already applied");
    });
  }

  public findClaimableRuns(now: Date, take: number): Promise<RelayChannelProbeClaimCandidate[]> {
    return prisma.relayChannelProbeRun.findMany({
      where: { OR: [{ status: "queued" }, { status: "running", leaseExpiresAt: { lt: now } }] },
      orderBy: { queuedAt: "asc" },
      take,
      include: { profile: { select: { probeGroup: true } } },
    });
  }

  public claimRun(runId: string, owner: string, now: Date, leaseExpiresAt: Date) {
    return prisma.relayChannelProbeRun.updateMany({
      where: { id: runId, OR: [{ status: "queued" }, { status: "running", leaseExpiresAt: { lt: now } }] },
      data: { status: "running", startedAt: now, leaseOwner: owner, leaseExpiresAt },
    });
  }

  public findRunWithProfile(runId: string): Promise<Prisma.RelayChannelProbeRunGetPayload<{
    include: { profile: { include: { relayChannel: true } } };
  }> | null> {
    return prisma.relayChannelProbeRun.findUnique({
      where: { id: runId },
      include: { profile: { include: { relayChannel: true } } },
    });
  }

  public heartbeatRun(runId: string, owner: string, leaseExpiresAt: Date) {
    return prisma.relayChannelProbeRun.updateMany({
      where: { id: runId, status: "running", leaseOwner: owner },
      data: { leaseExpiresAt },
    });
  }

  /**
   * Finalization is ownership-bound so a manually reset task cannot later be
   * overwritten by an already-running worker.
   */
  public completeClaimedRun(runId: string, owner: string, data: Prisma.RelayChannelProbeRunUpdateInput) {
    return prisma.relayChannelProbeRun.updateMany({
      where: { id: runId, status: "running", leaseOwner: owner },
      data,
    });
  }

  public async cancelActiveRuns(channelId: string, message: string): Promise<string[]> {
    return prisma.$transaction(async (tx) => {
      const active = await tx.relayChannelProbeRun.findMany({
        where: { relayChannelId: channelId, status: { in: ["queued", "running"] } },
        select: { id: true },
      });
      if (!active.length) return [];
      await tx.relayChannelProbeRun.updateMany({
        where: { id: { in: active.map((run) => run.id) }, status: { in: ["queued", "running"] } },
        data: {
          status: "cancelled",
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          errorMessage: message,
        },
      });
      return active.map((run) => run.id);
    });
  }

  public deleteRunsBefore(before: Date) {
    return prisma.relayChannelProbeRun.deleteMany({ where: { createTime: { lt: before } } });
  }
}

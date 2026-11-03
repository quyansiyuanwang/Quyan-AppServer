import { randomUUID } from "node:crypto";
import { Permission, RELAY_PROBE_MANAGEMENT_PATH, buildAcsResource } from "@quyan/shared";
import { RelayProbeRoundRepository, scheduledProbeResources } from "@/store/relay/relay-probe-round.repository";
import {
  RelayProbeRoundReportRepository,
  roundTargetIdentity,
} from "@/store/relay/relay-probe-round-report.repository";
import { RelayProbeRoundReadRepository } from "@/store/relay/relay-probe-round-read.repository";
import { RelayProbeScheduledAuthorityService } from "./relay-probe-scheduled-authority.service";
import { RelayChannelProbeService } from "./relay-channel-probe.service";
import { RELAY_PROBE_ROUND_POLICY as policy } from "./relay-probe-round-policy";
import { NotificationService } from "@/services/notification/notification.service";
import { ConfigService } from "@/services/system/config.service";
import type { RelayProbeRoundTargetReportDto } from "@/api/dto/relay/relay-probe-round.dto";
import { ConflictError, ForbiddenError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
const logger = getLogger("RelayProbeRoundScheduler", LogCategory.SYSTEM);

export class RelayProbeRoundSchedulerService {
  private static instance: RelayProbeRoundSchedulerService;
  static getInstance() {
    return (this.instance ??= new RelayProbeRoundSchedulerService());
  }
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  constructor(
    private readonly rounds = RelayProbeRoundRepository.getInstance(),
    private readonly reports = RelayProbeRoundReportRepository.getInstance(),
    private readonly authority = RelayProbeScheduledAuthorityService.getInstance(),
    private readonly probes = RelayChannelProbeService.getInstance(),
    private readonly notifications = NotificationService.getInstance(),
    private readonly config = ConfigService.getInstance(),
  ) {}
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), policy.tickMs);
    this.timer.unref();
    void this.tick();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(now = new Date()) {
    if (this.busy) return;
    this.busy = true;
    const owner = randomUUID();
    try {
      await this.rounds.due(now, async (actor) => {
        const guard = await this.authority.context(actor);
        await guard.recheck();
      });
      const claimed = await this.rounds.claimRounds(owner, now);
      for (const round of claimed) {
        try {
          const expired = now.getTime() - round.scheduledFor.getTime() > policy.roundTimeoutMs;
          if (round.state === "pending") {
            try {
              const guard = await this.authority.context(round.actorUserId);
              if (expired) await this.rounds.failPending(round.id, owner, "round-timeout");
              else
                await this.rounds.snapshotTargets(round.id, owner, guard, (profile, targetId, pooled, accountId) =>
                  this.probes.scheduledTargetConfigured(profile, targetId, pooled, accountId),
                );
            } catch (error) {
              if (error instanceof ForbiddenError)
                await this.rounds.failPending(round.id, owner, "authorization-or-configuration-unavailable");
              else throw error;
            }
          }
          for (const target of await this.rounds.targets(round.id)) {
            if (target.state === "pending" && !expired) {
              try {
                await this.probes.createScheduledRun(target, owner);
              } catch (error) {
                if (error instanceof ConflictError)
                  await this.rounds.skipTarget(target.id, "queue", "active-task-or-configuration-conflict");
                else if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 403)
                  await this.rounds.skipTarget(
                    target.id,
                    "authorization",
                    "authorization-or-configuration-unavailable",
                  );
                // A transient queue/backend failure stays pending for the next claim.
              }
            } else await this.reports.reconcile(target, expired);
          }
          await this.rounds.finish(round.id, owner);
        } catch {
          logger.warn("Probe round processing deferred", { roundId: round.id, reason: "round-processing-unavailable" });
        } finally {
          await this.rounds.release(round.id, owner);
        }
      }
      for (const delivery of await this.reports.claimNotifications(owner, now)) {
        const heartbeat = setInterval(
          () => {
            void this.reports.recheckDelivery(delivery.id, owner).catch(() => undefined);
          },
          Math.floor(policy.leaseMs / 3),
        );
        heartbeat.unref();
        try {
          const round = await this.reports.notificationData(delivery.roundId);
          if (
            round.state !== "completed" ||
            round.targets.some((target) => ["pending", "queued"].includes(target.state))
          )
            throw new Error("Round not terminal");
          const guard = await this.authority.context(
            round.actorUserId,
            "quyan:relay:GetProbeRound",
            Permission.RELAY_CHANNEL_PROBE_READ,
          );
          await guard.authorize([
            buildAcsResource({
              service: "quyan",
              region: "*",
              accountId: guard.principal.accountOwnerId,
              path: "account",
            }),
          ]);
          for (const target of round.targets) await guard.authorize(scheduledProbeResources(target));
          const config = await this.config.getSocialAuthConfig();
          const detailsUrl = new URL(RELAY_PROBE_MANAGEMENT_PATH, config.frontendBaseUrl);
          detailsUrl.searchParams.set("round", round.id);
          const targets = round.targets.map((target) =>
            target.report && typeof target.report === "object" && !Array.isArray(target.report)
              ? (target.report as unknown as RelayProbeRoundTargetReportDto)
              : roundTargetIdentity(target),
          );
          const state = await this.notifications.dispatchProbeRound(
            round.actorUserId,
            delivery.id,
            {
              roundId: round.id,
              scheduledFor: round.scheduledFor.toISOString(),
              targets,
              errorStage: round.errorStage ?? undefined,
              errorCode: round.errorCode ?? undefined,
              detailsUrl: detailsUrl.toString(),
            },
            async () => {
              await this.reports.recheckDelivery(delivery.id, owner);
              await RelayProbeRoundReadRepository.getInstance().authorizeTargets(round.id, guard);
            },
          );
          await this.reports.delivered(delivery.id, owner, state, delivery.id);
        } catch {
          await this.reports.deliveryFailed(delivery.id, owner, delivery.attempts + 1);
        } finally {
          clearInterval(heartbeat);
        }
      }
    } catch {
      logger.warn("Probe scheduler tick deferred", { reason: "scheduler-backend-unavailable" });
    } finally {
      this.busy = false;
    }
  }
}

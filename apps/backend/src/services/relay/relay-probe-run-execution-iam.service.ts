import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { principalConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import {
  platformRelayProbeProfileArn,
  platformRelayProbeQueueSlotArn,
  platformRelayProbeRunArn,
  platformRelayProbeAccountArn,
} from "@/iam/resources/platform-relay-probe-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { RelayProbeRunExecutionRepository } from "@/store/relay/relay-probe-run-execution.repository";
import { RelayChannelService } from "./relay-channel.service";
import { RelayProbeRunAdmissionStore } from "./relay-probe-run-admission";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { getLogger, LogCategory } from "@/util/logger";
export class RelayProbeRunExecutionIamService {
  private static instance: RelayProbeRunExecutionIamService;
  static getInstance() {
    return (this.instance ??= new RelayProbeRunExecutionIamService());
  }
  constructor(
    private readonly admissions = RelayProbeRunAdmissionStore.getInstance(),
    private readonly repository = RelayProbeRunExecutionRepository.getInstance(),
    private readonly identities = PlatformManagementReadRepository.getInstance(),
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly channels: Pick<
      RelayChannelService,
      "canAccessChannelMetadata"
    > = RelayChannelService.getInstance(),
  ) {}
  async prepare(runId: string, owner: string): Promise<() => Promise<void>> {
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    const claim = async () => {
      if (env.security.iamAuthorizationMode !== mode) throw iamAccountDenied();
      await this.repository.inspect(runId, owner);
    };
    await claim();
    if (mode === "legacy") return claim;
    const native = async () => {
      const input = await this.admissions.read(runId),
        principal = input.principal;
      const snapshot = await this.identities.snapshot(principal, Permission.RELAY_CHANNEL_PROBE_EXECUTE),
        fingerprint = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      if (
        snapshot.users.find((user) => user.id === principal.subjectUserId)?.updateTime.toISOString() !==
          input.identity.principalUpdatedAt ||
        snapshot.users.find((user) => user.id === principal.accountOwnerId)?.updateTime.toISOString() !==
          input.identity.ownerUpdatedAt
      )
        throw iamAccountDenied();
      const resources = [
        platformRelayChannelArn(input.channelId),
        platformRelayProbeProfileArn(input.channelId, input.profileId),
        platformRelayProbeRunArn(input.channelId, runId),
        platformRelayProbeQueueSlotArn(input.channelId, input.memberChannelId ?? undefined),
        ...(input.memberChannelId ? [platformRelayChannelArn(input.memberChannelId)] : []),
        ...(input.accountId ? [platformRelayProbeAccountArn(input.accountId)] : []),
      ];
      return async () => {
        if (input.expiresAt <= Date.now() || env.security.iamAuthorizationMode !== mode) throw iamAccountDenied();
        const parent = await this.repository.inspect(runId, owner, input);
        await this.identities.recheck(principal, Permission.RELAY_CHANNEL_PROBE_EXECUTE, snapshot);
        if (
          (await captureIamAccessKeyRevision(principal, input.identity.accessKeyId)) !==
          input.identity.accessKeyRevision
        )
          throw iamAccountDenied();
        if (
          !parent ||
          !(await this.channels.canAccessChannelMetadata(parent, principal.subjectUserId, principal.roleSessionId)) ||
          fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== fingerprint
        )
          throw iamAccountDenied();
        const action = "quyan:relay:CreateProbeRun",
          started = performance.now(),
          results = await this.iam.authorizeMany({
            principal,
            action,
            resources,
            context: { ...principalConditionContext(principal), ...input.transport },
          });
        if (
          !Array.isArray(results) ||
          results.length !== resources.length ||
          results.some((row) => !row || !["Allow", "ExplicitDeny", "ImplicitDeny"].includes(row.decision))
        )
          throw iamAccountDenied();
        results.forEach((result, index) =>
          auditIamDecision({
            principal,
            action,
            resource: resources[index]!,
            result,
            evaluationLatencyMs: performance.now() - started,
            authorizationMode: mode,
          }),
        );
        if (results.some((row) => row.decision !== "Allow")) throw iamAccountDenied();
      };
    };
    if (mode === "enforce") {
      const recheck = await native();
      await recheck();
      return recheck;
    }
    let recheck: (() => Promise<void>) | undefined;
    try {
      recheck = await native();
    } catch {
      /* Shadow cannot disable an otherwise valid legacy claim. */
    }
    return async () => {
      await claim();
      try {
        if (!recheck) throw iamAccountDenied();
        await recheck();
      } catch {
        getLogger("RelayProbeWorkerIam", LogCategory.SECURITY).warn("Probe worker shadow authorization differs", {
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    };
  }
}

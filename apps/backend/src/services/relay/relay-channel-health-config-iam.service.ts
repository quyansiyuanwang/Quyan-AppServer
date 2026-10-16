import type { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { RelayChannelHealthConfigRepository } from "@/store/relay/relay-channel-health-config.repository";
import { assertIamAccountPrincipal, iamAccountDenied } from "@/store/users/iam-account-principal";
import { platformManagementGroupSnapshot } from "@/store/users/platform-management-principal";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { PermissionService } from "@/services/users/permission.service";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { batchUpdateRelayChannelHealthConfigBodySchema } from "@/api/schema/relay/relay-channel.schema";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type {
  BatchUpdateRelayChannelHealthConfigRequest,
  BatchRelayChannelsResultDto,
  RelayChannelHealthDto,
} from "@/api/dto/relay/relay-channel.dto";
import { RelayChannelHealthService } from "./relay-channel-health.service";
import { projectRelayChannelHealth } from "./relay-channel-health-projection";
const action = "quyan:relay:UpdateChannelHealthConfig";
type Result = BatchRelayChannelsResultDto & { projection?: RelayChannelHealthDto };
export class RelayChannelHealthConfigIamService {
  private static instance: RelayChannelHealthConfigIamService;
  static getInstance() {
    return (this.instance ??= new RelayChannelHealthConfigIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository = RelayChannelHealthConfigRepository.getInstance(),
    private readonly snapshots = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  async execute(
    input: BatchUpdateRelayChannelHealthConfigRequest,
    actorUserId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<Result>,
    single = false,
  ): Promise<Result> {
    const parsed = batchUpdateRelayChannelHealthConfigBodySchema.safeParse(input);
    if (
      !parsed.success ||
      (single && parsed.data.ids.length !== 1) ||
      parsed.data.ids.some((id) => !isPlatformLogResourceId(id))
    )
      throw new BadRequestError("Invalid channel health configuration request", undefined, {
        messageKey: "errors.badRequest",
      });
    const { ids } = parsed.data,
      mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const current = getIamPrincipal(request);
    if (
      !current ||
      current.subjectUserId !== actorUserId ||
      current.principalUserId !== actorUserId ||
      request.oauthAccessToken
    )
      throw iamAccountDenied();
    const principal: IamPrincipal = { ...current };
    if (
      mode !== "enforce" &&
      !(
        await this.permissions.checkUserPermissions(actorUserId, [Permission.RELAY_CHANNEL_UPDATE], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const native = async (persist: boolean) => {
      const snapshot = await this.snapshots.snapshot(principal, Permission.RELAY_CHANNEL_UPDATE),
        fingerprint = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const keyId = request.accessKey?.id,
        keyRevision = await captureIamAccessKeyRevision(principal, keyId);
      const assertRequest = () => {
        if (
          JSON.stringify(getIamPrincipal(request)) !== JSON.stringify(principal) ||
          request.accessKey?.id !== keyId ||
          Boolean(request.oauthAccessToken)
        )
          throw iamAccountDenied();
      };
      const recheck = async (tx?: Prisma.TransactionClient) => {
        assertRequest();
        if (tx) {
          await assertIamAccountPrincipal(principal, tx);
          const group = await platformManagementGroupSnapshot(principal, Permission.RELAY_CHANNEL_UPDATE, tx);
          const users = await tx.user.findMany({
            where: { id: { in: snapshot.users.map((row) => row.id) }, status: 1 },
            select: { id: true, updateTime: true },
          });
          if (
            JSON.stringify(group) !== JSON.stringify(snapshot.group) ||
            users.length !== snapshot.users.length ||
            users.some(
              (row) =>
                !snapshot.users.some(
                  (old) => old.id === row.id && old.updateTime.getTime() === row.updateTime.getTime(),
                ),
            )
          )
            throw iamAccountDenied();
        } else await this.snapshots.recheck(principal, Permission.RELAY_CHANNEL_UPDATE, snapshot);
        if (
          fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId, tx)) !== keyRevision
        )
          throw iamAccountDenied();
        const decisions = await platformCollectionDecisions(this.iam, {
          principal,
          action,
          request,
          resources: ids.map(platformRelayChannelArn),
        });
        if (decisions.some((decision) => decision !== "Allow")) throw iamAccountDenied();
        assertRequest();
      };
      await recheck();
      const targets = await this.repository.candidates(ids);
      await recheck();
      return this.repository.apply(
        targets,
        parsed.data,
        { principal, snapshot, recheck },
        persist,
        single
          ? async (row) =>
              projectRelayChannelHealth(row, await RelayChannelHealthService.getInstance().getHealth(row.id))
          : undefined,
      );
    };
    if (mode === "enforce") return native(true);
    try {
      await native(false);
    } catch {
      getLogger("RelayChannelHealthConfigIam", LogCategory.SECURITY).warn(
        "Channel health configuration shadow evaluation failed",
        {
          action,
          reason: "iam-evaluation-denied-or-unavailable",
        },
      );
    }
    return legacy();
  }
}

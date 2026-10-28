import { isIP } from "node:net";
import { performance } from "node:perf_hooks";
import type { IamConditionContext } from "@quyan/shared";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { principalConditionContext } from "@/iam/request/condition-context";
import { isRemoteTerminalId, remoteTerminalSessionArn } from "@/iam/resources/remote-terminal-resources";
import { RedisService } from "@/services/infrastructure/redis.service";
import {
  terminalSessionRedisKey,
  type TerminalSessionMetadata,
} from "@/services/infrastructure/remote-terminal-session-projection";
import {
  RemoteTerminalSessionAuthorityRepository,
  type TerminalSessionAuthorityStore,
} from "@/store/remote-terminal-product/remote-terminal-session-authority.repository";
import { terminalDeviceDenied as denied } from "@/store/remote-terminal-product/remote-terminal-device-snapshot";
import { PermissionService } from "@/services/users/permission.service";
import type { TypedRequest } from "@/types/express";
import { getLogger, LogCategory } from "@/util/logger";
export type TerminalConnectionConditionContext = Partial<
  Pick<IamConditionContext, "acs:SourceIp" | "acs:UserAgent" | "acs:SecureTransport">
>;
export type TerminalSessionConnectionGuard = (connection: TerminalConnectionConditionContext) => Promise<void>;
export interface TerminalSessionAuthorityBinding {
  bindSession(sessionId: string): Promise<TerminalSessionConnectionGuard>;
}
/** Copies only safe authority metadata; guards never retain HTTP headers, JWT or key strings. */
export class RemoteTerminalSessionAuthorityService {
  private static instance: RemoteTerminalSessionAuthorityService;
  constructor(
    private readonly store: TerminalSessionAuthorityStore = RemoteTerminalSessionAuthorityRepository.getInstance(),
    private readonly sessions: Pick<RedisService, "projectTerminalSessions"> = RedisService.getInstance(),
    private readonly iam: Pick<IamAuthorizationService, "authorizeMany"> = IamAuthorizationService.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new RemoteTerminalSessionAuthorityService());
  }
  private transport(input: TerminalConnectionConditionContext): IamConditionContext {
    if (
      !input ||
      typeof input !== "object" ||
      Object.keys(input).some((key) => !["acs:SourceIp", "acs:SecureTransport", "acs:UserAgent"].includes(key))
    )
      throw denied();
    const ip = input["acs:SourceIp"],
      ua = input["acs:UserAgent"],
      secure = input["acs:SecureTransport"];
    if (
      (ip !== undefined && (typeof ip !== "string" || !isIP(ip))) ||
      (secure !== undefined && typeof secure !== "boolean") ||
      (ua !== undefined &&
        (typeof ua !== "string" ||
          ua.length > 512 ||
          [...ua].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)))
    )
      throw denied();
    return {
      ...(ip !== undefined ? { "acs:SourceIp": ip } : {}),
      ...(ua !== undefined ? { "acs:UserAgent": ua } : {}),
      "acs:SecureTransport": secure === true,
    };
  }
  private async metadata(userId: string, sessionId: string): Promise<TerminalSessionMetadata> {
    if (!isRemoteTerminalId(sessionId)) throw denied();
    const rows = await this.sessions.projectTerminalSessions(userId, [terminalSessionRedisKey(sessionId)]),
      row = rows?.[0];
    if (
      rows?.length !== 1 ||
      !row ||
      row.state !== "present" ||
      row.metadata.sessionId !== sessionId ||
      row.metadata.ownerUserId !== userId ||
      !["pending", "connected"].includes(row.metadata.status) ||
      ![row.metadata.deviceId, row.metadata.entitlementId].every(isRemoteTerminalId)
    )
      throw denied();
    return {
      sessionId: row.metadata.sessionId,
      ownerUserId: row.metadata.ownerUserId,
      entitlementId: row.metadata.entitlementId,
      deviceId: row.metadata.deviceId,
      status: row.metadata.status,
      revision: row.metadata.revision,
    };
  }
  async prepare(userId: string, deviceId: string, request: TypedRequest): Promise<TerminalSessionAuthorityBinding> {
    const principal = getIamPrincipal(request);
    if (
      !principal ||
      principal.subjectUserId !== userId ||
      principal.principalUserId !== userId ||
      request.oauthAccessToken ||
      request.user?.impersonatorId ||
      !isRemoteTerminalId(userId) ||
      !isRemoteTerminalId(deviceId)
    )
      throw denied();
    const captured = await this.store.capture({ ...principal }, deviceId, request.accessKey?.id);
    if (
      JSON.stringify(captured.principal) !== JSON.stringify(principal) ||
      captured.device.deviceId !== deviceId ||
      captured.device.userId !== userId ||
      captured.authenticationUpdatedAt !== request.user?.updatedAt ||
      captured.accessKeyId !== request.accessKey?.id ||
      !/^[a-f0-9]{64}$/.test(captured.userRevision) ||
      (captured.accessKeyId !== undefined && !/^[a-f0-9]{64}$/.test(captured.keyRevision ?? ""))
    )
      throw denied();
    const authority = Object.freeze({
      ...captured,
      principal: Object.freeze({ ...captured.principal }),
      device: Object.freeze({ ...captured.device }),
    });
    const requestId = request.res?.locals.requestId;
    return {
      bindSession: async (sessionId) => {
        const bound = await this.metadata(userId, sessionId);
        if (bound.deviceId !== deviceId) throw denied();
        await this.store.assertCurrent(authority);
        return async (input) => {
          const transport = this.transport(input),
            mode = env.security.iamAuthorizationMode;
          if (!["legacy", "shadow", "enforce"].includes(mode)) throw denied();
          const current = await this.metadata(userId, sessionId);
          if (current.deviceId !== bound.deviceId || current.entitlementId !== bound.entitlementId) throw denied();
          await this.store.assertCurrent(authority);
          if (
            mode !== "enforce" &&
            !(
              await this.permissions.checkUserPermissions(userId, [Permission.REMOTE_TERMINAL_SESSION_CREATE], {
                assumedRoleSessionId: authority.principal.roleSessionId,
              })
            ).hasPermission
          )
            throw denied();
          const checkPolicy = async () => {
            if (mode === "legacy") return;
            const resource = remoteTerminalSessionArn(authority.principal.accountOwnerId, userId, sessionId),
              action = "quyan:remote_terminal:ConnectSession",
              start = performance.now();
            try {
              const results = await this.iam.authorizeMany({
                  principal: { ...authority.principal },
                  action,
                  resources: [resource],
                  context: { ...transport, ...principalConditionContext(authority.principal) },
                }),
                result = results[0];
              if (
                results.length !== 1 ||
                !result ||
                !["Allow", "ImplicitDeny", "ExplicitDeny"].includes(result.decision)
              )
                throw denied();
              auditIamDecision({
                requestId,
                principal: authority.principal,
                action,
                resource,
                result,
                evaluationLatencyMs: performance.now() - start,
                authorizationMode: mode,
                ...(mode === "shadow" ? { legacyAllowed: true } : {}),
              });
              if (mode === "enforce" && result.decision !== "Allow") throw denied();
            } catch (error) {
              if (mode === "enforce") throw error;
              getLogger("TerminalConnectionIam", LogCategory.SECURITY).warn(
                "IAM terminal connection shadow unavailable",
                { action, reason: "iam-resource-unavailable" },
              );
            }
          };
          await checkPolicy();
          await this.store.assertCurrent(authority);
          const after = await this.metadata(userId, sessionId);
          if (
            after.deviceId !== bound.deviceId ||
            after.entitlementId !== bound.entitlementId ||
            after.revision !== current.revision
          )
            throw denied();
          // Fresh policy and time conditions after the asynchronous source reads.
          await checkPolicy();
        };
      },
    };
  }
}

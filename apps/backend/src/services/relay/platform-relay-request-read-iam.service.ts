import { createHash } from "node:crypto";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { platformRelayRequestArn, isRelayLogicalRequestId } from "@/iam/resources/platform-relay-request-resources";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { captureIamOAuthRevision } from "@/store/users/iam-oauth-authority";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import {
  PlatformRelayRequestReadRepository,
  type RelayRequestReadQuery,
  type RelayRequestReadTarget,
} from "@/store/relay/platform-relay-request-read.repository";
import { relayRequestDiagnosticsQuerySchema } from "@/api/schema/relay/relay.schema";
import type { RelayRequestDiagnosticsPageDto, RelayRequestRouteTraceDto } from "@/api/dto/relay/relay.dto";
import { PermissionService } from "../users/permission.service";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const listAction = "quyan:relay:ListRequestDiagnostics",
  traceAction = "quyan:relay:GetRequestRouteTrace",
  poolAction = "quyan:relay:ReadChannelPoolMetadata";
export class PlatformRelayRequestReadIamService {
  private static instance: PlatformRelayRequestReadIamService;
  static getInstance() {
    return (this.instance ??= new PlatformRelayRequestReadIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: Pick<
      PlatformManagementReadRepository,
      "snapshot" | "recheck"
    > = PlatformManagementReadRepository.getInstance(),
    private readonly repository: Pick<
      PlatformRelayRequestReadRepository,
      "scan" | "traceTarget" | "hydrate" | "channels"
    > = PlatformRelayRequestReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  private async run<T>(
    actorUserId: string,
    request: TypedRequest | undefined,
    trace: boolean,
    consume: (
      guard: {
        decide: (action: string, resources: readonly string[]) => Promise<readonly string[]>;
        recheck: () => Promise<void>;
      },
      hydrate: boolean,
    ) => Promise<T>,
    legacy: () => Promise<T>,
  ): Promise<T> {
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const identity = getIamPrincipal(request);
    if (!identity || identity.subjectUserId !== actorUserId || identity.principalUserId !== actorUserId)
      throw iamAccountDenied();
    const principal: IamPrincipal = { ...identity };
    const required = [
      Permission.RELAY_REQUEST_DIAGNOSTICS_READ,
      ...(trace ? [Permission.RELAY_REQUEST_ROUTE_TRACE_READ, Permission.RELAY_CHANNEL_POOL_METADATA_READ] : []),
    ];
    if (
      mode !== "enforce" &&
      !(
        await this.permissions.checkUserPermissions(actorUserId, required, {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const native = async (hydrate: boolean) => {
      const oauth = request.oauthAccessToken
        ? { id: request.oauthAccessToken.id, clientId: request.oauthAccessToken.oauthClientId }
        : undefined;
      const keyId = request.accessKey?.id;
      const assertRequest = () => {
        if (
          JSON.stringify(getIamPrincipal(request)) !== JSON.stringify(principal) ||
          request.accessKey?.id !== keyId ||
          (oauth
            ? request.oauthAccessToken?.id !== oauth.id ||
              request.oauthAccessToken.oauthClientId !== oauth.clientId ||
              request.oauthAccessToken.userId !== actorUserId
            : Boolean(request.oauthAccessToken))
        )
          throw iamAccountDenied();
      };
      assertRequest();
      // The historical JWT scope is preserved; platform membership never comes from an account-authored policy.
      const oauthRevision = await captureIamOAuthRevision(principal, oauth, ["relay:usage:read"]);
      const keyRevision = await captureIamAccessKeyRevision(principal, keyId);
      // Snapshot every ceiling independently. The generic any-of permission profile is not an all-of proof.
      const snapshots = await Promise.all(required.map((permission) => this.snapshots.snapshot(principal, permission)));
      const fingerprint = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const evaluations = new Map<
        string,
        { action: string; resources: readonly string[]; decisions: readonly string[] }
      >();
      const decide = async (action: string, resources: readonly string[]) => {
        const result: string[] = [];
        for (let offset = 0; offset < resources.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
          const batch = resources.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
          const decisions = await platformCollectionDecisions(this.iam, {
            principal,
            action,
            request,
            resources: batch,
          });
          const key = JSON.stringify([action, batch]),
            previous = evaluations.get(key);
          if (previous && decisions.some((value, index) => value !== previous.decisions[index]))
            throw iamAccountDenied();
          evaluations.set(key, { action, resources: batch, decisions });
          result.push(...decisions);
        }
        return result;
      };
      const recheck = async () => {
        assertRequest();
        for (let i = 0; i < required.length; i++) await this.snapshots.recheck(principal, required[i]!, snapshots[i]!);
        if (
          fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId)) !== keyRevision ||
          (await captureIamOAuthRevision(principal, oauth, ["relay:usage:read"])) !== oauthRevision
        )
          throw iamAccountDenied();
        assertRequest();
      };
      await recheck();
      const result = await consume({ decide, recheck }, hydrate);
      await recheck();
      for (const entry of [...evaluations.values()]) await decide(entry.action, entry.resources);
      await recheck();
      return result;
    };
    if (mode === "enforce") return native(true);
    try {
      await native(false);
    } catch {
      getLogger("RelayRequestIam", LogCategory.SECURITY).warn("Relay request shadow authorization failed", {
        action: trace ? traceAction : listAction,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
  async list(
    actorUserId: string,
    input: Omit<RelayRequestReadQuery, "page" | "pageSize"> & { page?: number; pageSize?: number },
    request: TypedRequest | undefined,
    legacy: () => Promise<RelayRequestDiagnosticsPageDto>,
  ): Promise<RelayRequestDiagnosticsPageDto> {
    const parsed = relayRequestDiagnosticsQuerySchema.strict().safeParse(input);
    if (
      !parsed.success ||
      (parsed.data.startDate && parsed.data.endDate && new Date(parsed.data.startDate) > new Date(parsed.data.endDate))
    )
      throw new BadRequestError("Invalid request diagnostics query", undefined, { messageKey: "errors.badRequest" });
    const query = { ...parsed.data, page: parsed.data.page ?? 1, pageSize: parsed.data.pageSize ?? 20 };
    return this.run(
      actorUserId,
      request,
      false,
      async (guard, hydrate) => {
        const collect = async () => {
          const admitted: RelayRequestReadTarget[] = [],
            hash = createHash("sha256");
          let after: string | undefined;
          for (;;) {
            await guard.recheck();
            const rows = await this.repository.scan(query, after);
            if (
              rows.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
              rows.some(
                (row, i) =>
                  !isRelayLogicalRequestId(row.id) ||
                  (i ? rows[i - 1]!.id >= row.id : after !== undefined && after >= row.id),
              )
            )
              throw iamAccountDenied();
            if (!rows.length) break;
            const decisions = await guard.decide(
              listAction,
              rows.map((row) => platformRelayRequestArn(row.id)),
            );
            rows.forEach((row, i) => {
              hash.update(JSON.stringify([row, decisions[i]]) + "\n");
              if (decisions[i] === "Allow") admitted.push(row);
            });
            after = rows.at(-1)!.id;
            if (rows.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
          }
          admitted.sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || b.id.localeCompare(a.id));
          return {
            total: admitted.length,
            page: admitted.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
            hash: hash.digest("hex"),
          };
        };
        const initial = await collect();
        if (!hydrate) return { ...query, total: initial.total, records: [] };
        const records: RelayRequestDiagnosticsPageDto["records"] = [];
        const observed = [];
        for (const target of initial.page) {
          const data = await this.repository.hydrate(target, false);
          observed.push({ target, signature: JSON.stringify(data) });
          records.push({
            resourceArn: platformRelayRequestArn(target.id),
            requestId: data.row.requestId,
            relayTokenId: data.row.relayToken.id,
            relayTokenName: data.row.relayToken.name ?? undefined,
            userId: data.row.relayToken.userId,
            username: data.row.relayToken.user.username,
            createTime: data.row.createTime,
            attempts: data.usages.map((usage) => this.attempt(usage)),
          });
        }
        const final = await collect();
        if (initial.hash !== final.hash || initial.total !== final.total) throw iamAccountDenied();
        for (const entry of observed)
          if (JSON.stringify(await this.repository.hydrate(entry.target, false)) !== entry.signature)
            throw iamAccountDenied();
        return { total: initial.total, page: query.page, pageSize: query.pageSize, records };
      },
      legacy,
    );
  }
  async trace(
    actorUserId: string,
    requestId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<RelayRequestRouteTraceDto>,
  ): Promise<RelayRequestRouteTraceDto> {
    if (
      typeof requestId !== "string" ||
      !requestId.length ||
      requestId.length > 64 ||
      Array.from(requestId).some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)
    )
      throw new BadRequestError("Invalid request trace identifier", undefined, { messageKey: "errors.badRequest" });
    return this.run(
      actorUserId,
      request,
      true,
      async (guard, hydrate) => {
        const target = await this.repository.traceTarget(requestId),
          resource = platformRelayRequestArn(target.id);
        if (
          (await guard.decide(listAction, [resource]))[0] !== "Allow" ||
          (await guard.decide(traceAction, [resource]))[0] !== "Allow"
        )
          throw iamAccountDenied();
        if (!hydrate) return { requestId, attempts: [] };
        const data = await this.repository.hydrate(target, true);
        const ids = [
          ...new Set(
            data.usages
              .map((usage) => usage.executionChannelId)
              .filter((id): id is string => typeof id === "string" && id.length > 0),
          ),
        ].sort();
        if (
          ids.some((id) => !isRelayLogicalRequestId(id)) ||
          (await guard.decide(poolAction, ids.map(platformRelayChannelArn))).some((value) => value !== "Allow")
        )
          throw iamAccountDenied();
        const channels = await this.repository.channels(ids),
          names = new Map(channels.map((row) => [row.id, row.name]));
        const result = {
          resourceArn: resource,
          requestId,
          attempts: data.usages.map((usage) => ({
            ...this.attempt(usage),
            executionChannelId: usage.executionChannelId ?? undefined,
            executionChannelName: usage.executionChannelId ? names.get(usage.executionChannelId) : undefined,
          })),
        };
        await guard.recheck();
        if (
          JSON.stringify(await this.repository.traceTarget(requestId)) !== JSON.stringify(target) ||
          JSON.stringify(await this.repository.hydrate(target, true)) !== JSON.stringify(data) ||
          JSON.stringify(await this.repository.channels(ids)) !== JSON.stringify(channels)
        )
          throw iamAccountDenied();
        return result;
      },
      legacy,
    );
  }
  private attempt(usage: {
    id: string;
    statusCode: number;
    method: string;
    path: string;
    totalTokens: number;
    timeToFirstByte: number | null;
    totalOutputTime: number | null;
    createTime: Date;
  }) {
    return {
      id: usage.id,
      statusCode: usage.statusCode,
      method: usage.method,
      path: usage.path,
      totalTokens: usage.totalTokens,
      timeToFirstByte: usage.timeToFirstByte ?? undefined,
      totalOutputTime: usage.totalOutputTime ?? undefined,
      createTime: usage.createTime,
    };
  }
}

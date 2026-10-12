import { performance } from "node:perf_hooks";
import type { IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { onlineSessionArn, onlineUserArn, isCanonicalOnlineId } from "@/iam/resources/online-session-resources";
import { iamAccountDenied as denied } from "@/store/users/iam-account-principal";
import { UserOnlineMonitorRepository } from "@/store/users/user-online-monitor.repository";
import type {
  UserOnlineMonitorStore,
  OnlineSessionTarget,
  OnlineSessionView,
} from "@/store/users/user-online-monitor.store";
import type { TypedRequest } from "@/types/express";
import { BadRequestError } from "@/util/errors";
export type OnlineOverviewParams = {
  page: number;
  pageSize: number;
  keyword?: string;
  ipAddress?: string;
  location?: string;
  status?: "online" | "offline";
};
export type OnlineTimelineParams = {
  userId: string;
  page: number;
  pageSize: number;
  onlineOnly?: boolean;
  offlineOnly?: boolean;
  startDate?: string;
  endDate?: string;
};
export class UserOnlineMonitorIamService {
  private static instance: UserOnlineMonitorIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: UserOnlineMonitorStore = UserOnlineMonitorRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new UserOnlineMonitorIamService());
  }
  private page(params: { page: number; pageSize: number }) {
    if (
      !Number.isSafeInteger(params.page) ||
      params.page < 1 ||
      !Number.isSafeInteger(params.pageSize) ||
      params.pageSize < 1 ||
      params.pageSize > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      !Number.isSafeInteger((params.page - 1) * params.pageSize)
    )
      throw new BadRequestError("Invalid online monitor pagination", undefined, { messageKey: "errors.badRequest" });
  }
  private async identity(request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (!request || !principal || principal.subjectUserId !== principal.principalUserId) throw denied();
    await this.iam.loadPolicies(principal);
    return { request, principal };
  }
  private async allowed(request: TypedRequest, principal: IamPrincipal, action: string, resources: string[]) {
    if (!resources.length) return new Set<string>();
    const start = performance.now(),
      results = await this.iam.authorizeMany({
        principal,
        action,
        resources,
        context: requestConditionContext(request, principal),
      });
    if (!Array.isArray(results) || results.length !== resources.length || resources.some((_, i) => !results[i]))
      throw denied();
    results.forEach((result, i) => {
      (request.iamDecisions ??= []).push({ ...result, action, resource: resources[i] });
      auditIamDecision({
        requestId: request.res?.locals.requestId,
        principal,
        action,
        resource: resources[i],
        result,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
        ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
      });
    });
    return new Set(resources.filter((_, i) => results[i].decision === "Allow"));
  }
  private async sessions(
    identity: { request: TypedRequest; principal: IamPrincipal },
    action: string,
    userId?: string,
  ) {
    if (userId !== undefined) {
      if (!isCanonicalOnlineId(userId) || !(await this.repository.userTarget(identity.principal, userId)))
        throw denied();
    }
    let after: OnlineSessionTarget | undefined;
    const rows: OnlineSessionView[] = [],
      seen = new Set<string>();
    const resource = (t: { id: string; userId: string }) =>
      onlineSessionArn(identity.principal.accountOwnerId, t.userId, t.id);
    while (true) {
      const targets = await this.repository.scan(identity.principal, userId, after);
      if (!targets.length) break;
      if (
        targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        targets.some((t, i) => {
          const previous = i ? targets[i - 1] : after;
          return (
            !isCanonicalOnlineId(t.id) ||
            !isCanonicalOnlineId(t.userId) ||
            t.status !== 1 ||
            seen.has(t.id) ||
            (userId !== undefined && t.userId !== userId) ||
            !(t.createTime instanceof Date) ||
            !Number.isFinite(t.createTime.getTime()) ||
            !(t.updateTime instanceof Date) ||
            !Number.isFinite(t.updateTime.getTime()) ||
            (previous &&
              (t.createTime > previous.createTime ||
                (t.createTime.getTime() === previous.createTime.getTime() && t.id >= previous.id)))
          );
        })
      )
        throw denied();
      targets.forEach((t) => seen.add(t.id));
      const allowed = await this.allowed(identity.request, identity.principal, action, targets.map(resource));
      const selected = targets.filter((t) => allowed.has(resource(t))),
        views = await this.repository.hydrate(identity.principal, selected);
      if (views.some((v) => !selected.some((t) => t.id === v.id && t.userId === v.userId))) throw denied();
      rows.push(...views);
      after = targets[targets.length - 1];
      if (targets.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
    }
    const final: OnlineSessionView[] = [];
    for (let i = 0; i < rows.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const chunk = rows.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
        allowed = await this.allowed(identity.request, identity.principal, action, chunk.map(resource));
      final.push(...chunk.filter((v) => allowed.has(resource(v))));
    }
    return final;
  }
  private state(row: OnlineSessionView, cutoff: Date, now: Date) {
    const isOnline = row.endedAt === null && row.lastHeartbeatAt > cutoff;
    const endedAt = row.endedAt ?? (!isOnline ? row.lastHeartbeatAt : undefined);
    return {
      isOnline,
      endedAt,
      durationSeconds:
        row.durationSeconds ?? Math.max(0, Math.floor(((endedAt ?? now).getTime() - row.startedAt.getTime()) / 1000)),
    };
  }
  async overview(params: OnlineOverviewParams, timeoutSeconds: number, request?: TypedRequest) {
    this.page(params);
    const identity = await this.identity(request),
      now = new Date(),
      cutoff = new Date(now.getTime() - timeoutSeconds * 1000);
    const rows = await this.sessions(identity, "quyan:user:ListOnlineSessions");
    const all = rows.map((row) => ({
      userId: row.userId,
      username: row.user.username,
      name: row.user.name,
      sessionId: row.id,
      authSessionId: row.authSessionId,
      startedAt: row.startedAt.toISOString(),
      lastHeartbeatAt: row.lastHeartbeatAt.toISOString(),
      endedAt: this.state(row, cutoff, now).endedAt?.toISOString(),
      durationSeconds: this.state(row, cutoff, now).durationSeconds,
      isOnline: this.state(row, cutoff, now).isOnline,
      ipAddress: row.lastIpAddress,
      location: row.lastLocation,
      userAgent: row.userAgent,
    }));
    const keyword = params.keyword?.trim().toLowerCase();
    const selected = all
      .filter(
        (row) =>
          (!keyword || [row.userId, row.username, row.name ?? ""].some((v) => v.toLowerCase().includes(keyword))) &&
          (!params.ipAddress || row.ipAddress.includes(params.ipAddress)) &&
          (!params.location || (row.location ?? "").includes(params.location)) &&
          (!params.status || row.isOnline === (params.status === "online")),
      )
      .sort((a, b) => b.lastHeartbeatAt.localeCompare(a.lastHeartbeatAt) || b.sessionId.localeCompare(a.sessionId));
    const items = selected.slice((params.page - 1) * params.pageSize, params.page * params.pageSize);
    const onlineUsers = new Set(all.filter((row) => row.isOnline).map((row) => row.userId)),
      users = new Set(all.map((row) => row.userId));
    return {
      items,
      total: selected.length,
      page: params.page,
      pageSize: params.pageSize,
      stats: {
        onlineUsers: onlineUsers.size,
        offlineUsers: users.size - onlineUsers.size,
        activeSessions: all.filter((row) => row.isOnline).length,
        averageDurationSeconds: items.length
          ? Math.floor(items.reduce((sum, row) => sum + row.durationSeconds, 0) / items.length)
          : 0,
      },
    };
  }
  async detail(userId: string, timeoutSeconds: number, request?: TypedRequest) {
    const identity = await this.identity(request);
    if (!isCanonicalOnlineId(userId)) throw denied();
    const target = await this.repository.userTarget(identity.principal, userId);
    if (!target || target.id !== userId) throw denied();
    const resource = onlineUserArn(identity.principal.accountOwnerId, userId),
      action = "quyan:user:GetOnlineUser";
    if (!(await this.allowed(identity.request, identity.principal, action, [resource])).has(resource)) throw denied();
    const row = await this.repository.detail(identity.principal, target, new Date(Date.now() - timeoutSeconds * 1000));
    if (!row || row.userId !== userId) throw denied();
    const current = await this.repository.userTarget(identity.principal, userId);
    if (
      !current ||
      current.updateTime.getTime() !== target.updateTime.getTime() ||
      !(await this.allowed(identity.request, identity.principal, action, [resource])).has(resource)
    )
      throw denied();
    return row;
  }
  async timeline(params: OnlineTimelineParams, timeoutSeconds: number, request?: TypedRequest) {
    this.page(params);
    const start = params.startDate ? new Date(params.startDate) : undefined,
      end = params.endDate ? new Date(params.endDate) : undefined;
    if (
      (start && !Number.isFinite(start.getTime())) ||
      (end && !Number.isFinite(end.getTime())) ||
      (start && end && start > end) ||
      (params.onlineOnly && params.offlineOnly)
    )
      throw new BadRequestError("Invalid online monitor date or status filters", undefined, {
        messageKey: "errors.badRequest",
      });
    const identity = await this.identity(request),
      now = new Date(),
      cutoff = new Date(now.getTime() - timeoutSeconds * 1000);
    const rows = await this.sessions(identity, "quyan:user:GetOnlineUserTimeline", params.userId);
    const filtered = rows
      .filter(
        (row) =>
          (!start || row.startedAt >= start) &&
          (!end || row.startedAt <= end) &&
          (!params.onlineOnly || this.state(row, cutoff, now).isOnline) &&
          (!params.offlineOnly || !this.state(row, cutoff, now).isOnline),
      )
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || b.id.localeCompare(a.id));
    const items = filtered.slice((params.page - 1) * params.pageSize, params.page * params.pageSize).map((row) => {
      const state = this.state(row, cutoff, now);
      return {
        sessionId: row.id,
        authSessionId: row.authSessionId,
        startedAt: row.startedAt.toISOString(),
        lastHeartbeatAt: row.lastHeartbeatAt.toISOString(),
        endedAt: state.endedAt?.toISOString(),
        durationSeconds: state.durationSeconds,
        ipAddress: row.lastIpAddress,
        location: row.lastLocation,
        userAgent: row.userAgent,
        isOnline: state.isOnline,
      };
    });
    return {
      items,
      total: filtered.length,
      page: params.page,
      pageSize: params.pageSize,
      groups: { online: items.filter((row) => row.isOnline), offline: items.filter((row) => !row.isOnline) },
    };
  }
}

import { performance } from "node:perf_hooks";
import type { IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";
import { ticketArn, isCanonicalTicketId } from "@/iam/resources/ticket-resources";
import { TicketRepository } from "@/store/ticket/ticket.repository";
import type { TicketStore, OwnTicketTarget, TicketListFilters } from "@/store/ticket/ticket.store";
import { ticketListQuerySchema } from "@/api/schema/ticket/ticket.schema";
import type { TypedRequest } from "@/types/express";
import { BadRequestError, ForbiddenError } from "@/util/errors";
const denied = () =>
  new ForbiddenError("Own ticket authorization unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });

/** Nullable lastReplyAt sorts after non-null values, with deterministic time/id tie breakers. */
export function ownTicketFollows(previous: OwnTicketTarget, next: OwnTicketTarget): boolean {
  if (previous.lastReplyAt?.getTime() !== next.lastReplyAt?.getTime())
    return previous.lastReplyAt !== null && (next.lastReplyAt === null || next.lastReplyAt < previous.lastReplyAt);
  return (
    next.createTime < previous.createTime ||
    (next.createTime.getTime() === previous.createTime.getTime() && next.id < previous.id)
  );
}

export class OwnTicketIamService {
  private static instance: OwnTicketIamService;
  private constructor(
    private readonly repository: Pick<
      TicketStore,
      "scanOwnTargets" | "readOwnTargets" | "findOwnTarget" | "readOwnDetail"
    > = TicketRepository.getInstance(),
    private readonly iam = IamAuthorizationService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new OwnTicketIamService());
  }
  private identity(userId: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (!request || !principal || principal.subjectUserId !== userId || !isCanonicalTicketId(userId)) throw denied();
    return { request, principal };
  }
  private async filter(request: TypedRequest, principal: IamPrincipal, action: string, resources: readonly string[]) {
    if (!resources.length) return [];
    const start = performance.now();
    const results = await this.iam.authorizeMany({
      principal,
      action,
      resources: [...resources],
      context: requestConditionContext(request, principal),
    });
    if (results.length !== resources.length || resources.some((_, index) => !results[index])) throw denied();
    results.forEach((result, index) => {
      (request.iamDecisions ??= []).push({ ...result, action, resource: resources[index] });
      auditIamDecision({
        requestId: request.res?.locals.requestId,
        principal,
        action,
        resource: resources[index],
        result,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
        ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
        batchSize: resources.length,
        batchIndex: index,
      });
    });
    return resources.filter((_, index) => results[index].decision === "Allow");
  }
  async authorizeCreate(userId: string, request?: TypedRequest) {
    const identity = this.identity(userId, request),
      resource = await iamAuthenticatedUserResourceResolver(identity);
    if (
      typeof resource !== "string" ||
      (await this.filter(identity.request, identity.principal, "quyan:ticket:CreateTicket", [resource])).length !== 1
    )
      throw denied();
    return identity.principal;
  }
  async authorizeTarget(id: string, userId: string, action: string, request?: TypedRequest) {
    const identity = this.identity(userId, request);
    if (!isCanonicalTicketId(id)) throw denied();
    const target = await this.repository.findOwnTarget(id, userId, identity.principal.accountOwnerId);
    if (!target || target.id !== id || target.userId !== userId) throw denied();
    if (
      (
        await this.filter(identity.request, identity.principal, action, [
          ticketArn(identity.principal.accountOwnerId, userId, id),
        ])
      ).length !== 1
    )
      throw denied();
    return { target, principal: identity.principal };
  }
  async detail(id: string, userId: string, action: string, request?: TypedRequest) {
    const { target, principal } = await this.authorizeTarget(id, userId, action, request);
    const detail = await this.repository.readOwnDetail(userId, principal.accountOwnerId, target);
    const latest = await this.authorizeTarget(id, userId, action, request);
    if (
      latest.target.updateTime.getTime() !== target.updateTime.getTime() ||
      detail.ticket.id !== id ||
      detail.ticket.userId !== userId ||
      detail.ticket.status !== 1 ||
      detail.ticket.updateTime.getTime() !== target.updateTime.getTime() ||
      detail.comments.some(
        (comment) => comment.ticketId !== id || comment.visibility !== "public" || comment.status !== 1,
      )
    )
      throw denied();
    return detail;
  }
  async createdDetail(target: OwnTicketTarget, userId: string, request?: TypedRequest) {
    const principal = await this.authorizeCreate(userId, request);
    const result = await this.repository.readOwnDetail(userId, principal.accountOwnerId, target);
    await this.authorizeCreate(userId, request);
    if (
      result.ticket.id !== target.id ||
      result.ticket.userId !== userId ||
      result.ticket.status !== 1 ||
      result.ticket.updateTime.getTime() !== target.updateTime.getTime() ||
      result.comments.some(
        (comment) => comment.ticketId !== target.id || comment.visibility !== "public" || comment.status !== 1,
      )
    )
      throw denied();
    return result;
  }
  async list(userId: string, filters: TicketListFilters, request?: TypedRequest) {
    const { request: trusted, principal } = this.identity(userId, request);
    if (
      !ticketListQuerySchema.safeParse(filters).success ||
      !Number.isSafeInteger((filters.page - 1) * filters.pageSize)
    )
      throw new BadRequestError("Invalid ticket pagination", undefined, { messageKey: "errors.validationFailed" });
    await this.iam.loadPolicies(principal);
    let after: OwnTicketTarget | undefined,
      total = 0;
    const selected: OwnTicketTarget[] = [];
    while (true) {
      const targets = await this.repository.scanOwnTargets(userId, principal.accountOwnerId, filters, after);
      if (!targets.length) break;
      if (
        targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        targets.some((target, index) => {
          const previous = index ? targets[index - 1] : after;
          return (
            target.userId !== userId ||
            !isCanonicalTicketId(target.id) ||
            (previous && !ownTicketFollows(previous, target))
          );
        })
      )
        throw denied();
      const resources = targets.map((target) => ticketArn(principal.accountOwnerId, userId, target.id));
      const allowed = new Set(await this.filter(trusted, principal, "quyan:ticket:ListOwnTickets", resources));
      for (const [index, target] of targets.entries()) {
        if (!allowed.has(resources[index])) continue;
        if (total >= (filters.page - 1) * filters.pageSize && selected.length < filters.pageSize) selected.push(target);
        total++;
      }
      after = targets[targets.length - 1];
      if (targets.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
    }
    const resources = selected.map((target) => ticketArn(principal.accountOwnerId, userId, target.id));
    if ((await this.filter(trusted, principal, "quyan:ticket:ListOwnTickets", resources)).length !== resources.length)
      throw denied();
    const rows = await this.repository.readOwnTargets(userId, principal.accountOwnerId, selected);
    const byId = new Map(rows.map((row) => [row.id, row]));
    if (
      rows.length !== selected.length ||
      byId.size !== selected.length ||
      selected.some((target) => {
        const row = byId.get(target.id);
        return (
          !row || row.userId !== userId || row.status !== 1 || row.updateTime.getTime() !== target.updateTime.getTime()
        );
      })
    )
      throw denied();
    if ((await this.filter(trusted, principal, "quyan:ticket:ListOwnTickets", resources)).length !== resources.length)
      throw denied();
    await this.iam.loadPolicies(principal);
    return { items: selected.map((target) => byId.get(target.id)!), total };
  }
}

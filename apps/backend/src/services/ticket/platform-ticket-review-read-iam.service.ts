import type { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { IamAuthorizationService as AuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformTicketReviewArn } from "@/iam/resources/platform-ticket-review-resources";
import { isCanonicalTicketId } from "@/iam/resources/ticket-resources";
import { PlatformMetadataCollectionIamService } from "@/services/system/platform-metadata-collection-iam.service";
import { PlatformResourceReadIamService } from "@/services/system/platform-resource-read-iam.service";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import {
  PlatformTicketReviewReadRepository,
  validTicketReviewTarget,
  sameTicketReviewComments,
} from "@/store/ticket/platform-ticket-review-read.repository";
import type {
  PlatformTicketReviewReadStore,
  TicketReviewReadTarget,
} from "@/store/ticket/platform-ticket-review-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
import type { TicketReviewListQueryDto } from "@/api/dto/ticket/ticket.dto";
import { ticketReviewListQuerySchema } from "@/api/schema/ticket/ticket.schema";
import { BadRequestError } from "@/util/errors";
export class PlatformTicketReviewReadIamService {
  private static instance: PlatformTicketReviewReadIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = AuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformTicketReviewReadStore = PlatformTicketReviewReadRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformTicketReviewReadIamService());
  }
  private identity(request: TypedRequest) {
    const principal = getIamPrincipal(request);
    if (!principal || request.oauthAccessToken || principal.subjectUserId !== principal.principalUserId)
      throw iamAccountDenied();
    return { ...principal };
  }
  async list(input: TicketReviewListQueryDto, request: TypedRequest, hydrate = true) {
    const parsed = ticketReviewListQuerySchema.strict().safeParse(input);
    if (!parsed.success)
      throw new BadRequestError("Invalid ticket review query", undefined, { messageKey: "errors.badRequest" });
    const principal = this.identity(request),
      query = parsed.data,
      page = query.page ?? 1,
      pageSize = query.pageSize ?? 20;
    const selected: TicketReviewReadTarget[] = [];
    const result = await new PlatformMetadataCollectionIamService(
      this.iam,
      this.snapshots,
      {
        where: () =>
          this.repository.where({
            ...query,
            page,
            pageSize,
            startTime: query.startTime ? new Date(query.startTime) : undefined,
            endTime: query.endTime ? new Date(query.endTime) : undefined,
          }),
        scan: (where, after, boundary) => this.repository.scan(principal, where, after, boundary),
      },
      (target: TicketReviewReadTarget) => {
        if (!validTicketReviewTarget(target)) throw iamAccountDenied();
        return platformTicketReviewArn(target.userId, target.id);
      },
      (target) => [target.userId, target.lastReplyAt?.toISOString() ?? null, target.revision],
    ).read("quyan:ticket:ListReviewTickets", principal, request, input, {
      visit: async (targets) => {
        selected.push(...targets);
        // Retain only the prefix needed by the requested page, using the existing review queue order.
        selected.sort(
          (a, b) =>
            (b.lastReplyAt?.getTime() ?? -Infinity) - (a.lastReplyAt?.getTime() ?? -Infinity) ||
            b.createTime.getTime() - a.createTime.getTime() ||
            b.id.localeCompare(a.id),
        );
        selected.splice(page * pageSize);
      },
      finish: async (total) => {
        if (!hydrate) return { items: [], total, page, pageSize, hasMore: page * pageSize < total };
        const targets = selected.slice((page - 1) * pageSize),
          rows = await this.repository.hydrate(principal, targets);
        if (
          !Array.isArray(rows) ||
          rows.length !== targets.length ||
          new Set(rows.map((row) => row.id)).size !== rows.length ||
          rows.some(
            (row) =>
              row.status !== 1 || !targets.some((target) => target.id === row.id && target.userId === row.userId),
          )
        )
          throw iamAccountDenied();
        const byId = new Map(rows.map((row) => [row.id, row]));
        return {
          items: targets.map((target) => byId.get(target.id)!),
          total,
          page,
          pageSize,
          hasMore: page * pageSize < total,
        };
      },
    });
    if (!result) throw iamAccountDenied();
    return result;
  }
  async detail(id: string, request: TypedRequest, hydrate = true) {
    const principal = this.identity(request);
    if (!isCanonicalTicketId(id)) throw iamAccountDenied();
    // Load only safe metadata; the submitted owner/header cannot choose the resource identity.
    const target = await this.repository.target(principal, id);
    if (!target || target.id !== id || !validTicketReviewTarget(target)) throw iamAccountDenied();
    return new PlatformResourceReadIamService(this.iam, this.snapshots).read(
      "quyan:ticket:GetReviewTicket",
      principal,
      request,
      platformTicketReviewArn(target.userId, target.id),
      async (guard) => {
        guard.trackSource(() => this.repository.recheck(principal, [target]));
        if (!hydrate) return undefined;
        const comments = await this.repository.comments(principal, target);
        sameTicketReviewComments(comments, comments);
        guard.trackSource(async () =>
          sameTicketReviewComments(await this.repository.comments(principal, target), comments),
        );
        await guard.recheck();
        return this.repository.detail(principal, target, comments);
      },
    );
  }
}

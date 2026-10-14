import { Permission } from "@quyan/shared";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformTicketReviewArn } from "@/iam/resources/platform-ticket-review-resources";
import { isCanonicalTicketId } from "@/iam/resources/ticket-resources";
import { PlatformResourceReadIamService } from "@/services/system/platform-resource-read-iam.service";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import {
  PlatformTicketReviewMutationRepository,
  normalizeTicketReviewMutation,
} from "@/store/ticket/platform-ticket-review-mutation.repository";
import {
  sameTicketReviewTargets,
  sameTicketReviewComments,
  validTicketReviewTarget,
} from "@/store/ticket/ticket-review-snapshot";
import type {
  PlatformTicketReviewMutationStore,
  TicketReviewMutationInput,
  TicketReviewMutationGuard,
} from "@/store/ticket/platform-ticket-review-mutation.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
const permission = Permission.TICKET_REVIEW_UPDATE;
export class PlatformTicketReviewMutationIamService {
  private static instance: PlatformTicketReviewMutationIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformTicketReviewMutationStore = PlatformTicketReviewMutationRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformTicketReviewMutationIamService());
  }
  async execute(
    id: string,
    reviewerUserId: string,
    raw: TicketReviewMutationInput,
    request?: TypedRequest,
    persist = true,
  ) {
    const identity = request && getIamPrincipal(request);
    if (
      !request ||
      !identity ||
      identity.subjectUserId !== reviewerUserId ||
      identity.principalUserId !== reviewerUserId ||
      request.oauthAccessToken ||
      !isCanonicalTicketId(id)
    )
      throw iamAccountDenied();
    const principal = { ...identity },
      input = normalizeTicketReviewMutation(raw),
      action =
        input.kind === "update"
          ? "quyan:ticket:UpdateReviewTicket"
          : input.kind === "comment"
            ? "quyan:ticket:AddReviewComment"
            : "quyan:ticket:DeleteReviewTicket";
    const target = await this.repository.target(principal, id);
    if (!target || target.id !== id || !validTicketReviewTarget(target)) throw iamAccountDenied();
    const prepared = await new PlatformResourceReadIamService(this.iam, this.snapshots).read(
      action,
      principal,
      request,
      platformTicketReviewArn(target.userId, target.id),
      async (guard) => {
        const snapshot = await this.snapshots.snapshot(principal, permission),
          authorizationRevision = await this.repository.authorizationRevision(principal),
          comments = input.kind === "update" ? await this.repository.comments(principal, target) : [];
        sameTicketReviewComments(comments, comments);
        const mutation: TicketReviewMutationGuard = {
          action,
          target: { ...target },
          comments,
          group: snapshot.group,
          authorizationRevision,
          users: {
            principal,
            targetUserId: reviewerUserId,
            users: snapshot.users,
            recheck: async () => {
              await guard.recheck();
              await this.snapshots.recheck(principal, permission, snapshot);
              if ((await this.repository.authorizationRevision(principal)) !== authorizationRevision)
                throw iamAccountDenied();
            },
          },
        };
        if (!persist)
          guard.trackSource(async () => {
            const current = await this.repository.target(principal, id);
            sameTicketReviewTargets(current ? [current] : [], [target]);
            if (input.kind === "update")
              sameTicketReviewComments(await this.repository.comments(principal, target), comments);
          });
        return mutation;
      },
    );
    if (!persist) return undefined;
    return this.repository.mutate(prepared, input);
  }
}

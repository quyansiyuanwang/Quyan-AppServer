import { Prisma } from "@prisma/client";
import { Permission, MANAGED_STATUS, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { ConflictError, BadRequestError } from "@/util/errors";
import {
  readTicketReviewTargets,
  readTicketReviewCommentTargets,
  sameTicketReviewTargets,
  sameTicketReviewComments,
  validTicketReviewTarget,
} from "./ticket-review-snapshot";
import { reviewTicketBodySchema, createTicketReviewCommentBodySchema } from "@/api/schema/ticket/ticket.schema";
import type {
  PlatformTicketReviewMutationStore,
  TicketReviewMutationGuard,
  TicketReviewMutationInput,
  TicketReviewMutationResult,
} from "./platform-ticket-review-mutation.store";
const permission = Permission.TICKET_REVIEW_UPDATE;
const writePolicy = Object.freeze({ timeoutMs: 30000 });
export function normalizeTicketReviewMutation(input: TicketReviewMutationInput): TicketReviewMutationInput {
  if (input.kind === "delete") {
    if (Object.keys(input).some((key) => key !== "kind")) throw iamAccountDenied();
    return { kind: "delete" };
  }
  const parsed = (input.kind === "update" ? reviewTicketBodySchema : createTicketReviewCommentBodySchema).safeParse(
    input.data,
  );
  if (
    !parsed.success ||
    Object.keys(input).some((key) => !["kind", "data"].includes(key)) ||
    Object.keys(input.data).some((key) => !Object.prototype.hasOwnProperty.call(parsed.data, key))
  )
    throw new BadRequestError("Invalid ticket review mutation", undefined, { messageKey: "errors.badRequest" });
  if (input.kind === "update") {
    const data = reviewTicketBodySchema.parse(input.data);
    if (Object.values(data).every((value) => value === undefined))
      throw new BadRequestError("Empty ticket review update", undefined, { messageKey: "errors.badRequest" });
    return {
      kind: "update",
      data: {
        ...data,
        ...(data.assigneeUserId !== undefined ? { assigneeUserId: data.assigneeUserId?.trim() || null } : {}),
      },
    };
  }
  if (input.kind === "comment") return { kind: "comment", data: createTicketReviewCommentBodySchema.parse(input.data) };
  throw iamAccountDenied();
}
export class PlatformTicketReviewMutationRepository implements PlatformTicketReviewMutationStore {
  private static instance: PlatformTicketReviewMutationRepository;
  static getInstance() {
    return (this.instance ??= new PlatformTicketReviewMutationRepository());
  }
  private qualify(principal: IamPrincipal, tx: Prisma.TransactionClient = prisma) {
    return platformManagementGroupSnapshot(principal, permission, tx);
  }
  async target(principal: IamPrincipal, id: string) {
    await this.qualify(principal);
    return (await readTicketReviewTargets(prisma, [id]))[0] ?? null;
  }
  async comments(principal: IamPrincipal, target: TicketReviewMutationGuard["target"]) {
    await this.qualify(principal);
    sameTicketReviewTargets(await readTicketReviewTargets(prisma, [target.id]), [target]);
    return readTicketReviewCommentTargets(prisma, target);
  }
  async authorizationRevision(principal: IamPrincipal) {
    await this.qualify(principal);
    return readIamAuthorizationRevision(prisma, principal.accountOwnerId);
  }
  private async identity(tx: Prisma.TransactionClient, guard: TicketReviewMutationGuard) {
    if (!guard.group || !/^[a-f0-9]{64}$/.test(guard.authorizationRevision)) throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.principal.subjectUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id=${guard.group.id} FOR UPDATE`);
    const current = await this.qualify(guard.users.principal, tx);
    if (
      current.id !== guard.group.id ||
      current.updateTime.getTime() !== guard.group.updateTime.getTime() ||
      (await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !== guard.authorizationRevision
    )
      throw iamAccountDenied();
  }
  async mutate(guard: TicketReviewMutationGuard, raw: TicketReviewMutationInput): Promise<TicketReviewMutationResult> {
    const input = normalizeTicketReviewMutation(raw),
      action =
        input.kind === "update"
          ? "quyan:ticket:UpdateReviewTicket"
          : input.kind === "comment"
            ? "quyan:ticket:AddReviewComment"
            : "quyan:ticket:DeleteReviewTicket";
    if (guard.action !== action || !validTicketReviewTarget(guard.target)) throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.identity(tx, guard);
          sameTicketReviewTargets(await readTicketReviewTargets(tx, [guard.target.id], true), [guard.target]);
          if (input.kind === "update")
            sameTicketReviewComments(await readTicketReviewCommentTargets(tx, guard.target, true), guard.comments);
          const before = await tx.ticket.findFirst({
            where: { id: guard.target.id, userId: guard.target.userId, status: 1 },
            include: {
              user: { select: { id: true, username: true } },
              assignee: { select: { id: true, username: true } },
            },
          });
          if (!before) throw iamAccountDenied();
          const result: TicketReviewMutationResult = { before };
          if (input.kind === "delete")
            await tx.ticket.update({ where: { id: before.id }, data: { status: MANAGED_STATUS.DELETED } });
          else if (input.kind === "comment") {
            result.comment = await tx.ticketComment.create({
              data: { ticketId: before.id, authorUserId: guard.users.principal.subjectUserId, ...input.data },
              include: { author: { select: { id: true, username: true } } },
            });
            await tx.ticket.update({ where: { id: before.id }, data: { lastReplyAt: result.comment.createTime } });
          } else {
            const id = input.data.assigneeUserId;
            if (id) {
              await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id=${id} FOR UPDATE`);
              if (!(await tx.user.findFirst({ where: { id, status: 1 }, select: { id: true } })))
                throw new BadRequestError("Ticket assignee unavailable", undefined, {
                  messageKey: "ticket.assigneeUnavailable",
                });
            }
            const ticket = await tx.ticket.update({
              where: { id: before.id },
              data: input.data,
              include: {
                user: { select: { id: true, username: true } },
                assignee: { select: { id: true, username: true } },
              },
            });
            const comments = await tx.ticketComment.findMany({
              where: { ticketId: ticket.id, status: 1 },
              include: { author: { select: { id: true, username: true } } },
              orderBy: [{ createTime: "asc" }, { id: "asc" }],
            });
            if (comments.length !== guard.comments.length) throw iamAccountDenied();
            sameTicketReviewComments(await readTicketReviewCommentTargets(tx, guard.target), guard.comments);
            result.detail = { ticket, comments };
          }
          // Recheck before COMMIT so a revoked write never leaves a partial update or comment behind.
          await this.identity(tx, guard);
          await guard.users.recheck();
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: writePolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("Ticket or authorization context changed", undefined, {
          messageKey: "errors.conflict",
        });
      throw error;
    }
  }
}

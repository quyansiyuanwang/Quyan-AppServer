import {
  readTicketReviewTargets,
  readTicketReviewCommentTargets,
  sameTicketReviewTargets,
  sameTicketReviewComments,
} from "./ticket-review-snapshot";
export { validTicketReviewTarget, sameTicketReviewTargets, sameTicketReviewComments } from "./ticket-review-snapshot";
import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isCanonicalTicketId } from "@/iam/resources/ticket-resources";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import { buildTicketWhere } from "./ticket-query";
import type {
  PlatformTicketReviewReadStore,
  TicketReviewReadTarget,
  TicketReviewCommentTarget,
} from "./platform-ticket-review-read.store";
import type { PlatformCollectionCursor } from "../system/platform-collection.store";
import type { TicketListFilters } from "./ticket.store";
export class PlatformTicketReviewReadRepository implements PlatformTicketReviewReadStore {
  private static instance: PlatformTicketReviewReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformTicketReviewReadRepository());
  }
  private qualify(principal: IamPrincipal, tx: Prisma.TransactionClient = prisma) {
    return platformManagementGroupSnapshot(principal, Permission.TICKET_REVIEW_READ, tx);
  }
  async where(filters: TicketListFilters) {
    return buildTicketWhere(filters);
  }
  private validCursor(cursor: PlatformCollectionCursor) {
    if (
      !isCanonicalTicketId(cursor.id) ||
      !(cursor.createTime instanceof Date) ||
      !Number.isFinite(cursor.createTime.getTime())
    )
      throw iamAccountDenied();
  }
  async scan(
    principal: IamPrincipal,
    where: Prisma.TicketWhereInput,
    after?: PlatformCollectionCursor,
    boundary?: PlatformCollectionCursor,
  ) {
    await this.qualify(principal);
    if (after) this.validCursor(after);
    if (boundary) this.validCursor(boundary);
    const rows = await prisma.ticket.findMany({
      where: {
        AND: [
          where,
          { status: 1 },
          ...(after
            ? [
                {
                  OR: [
                    { createTime: { lt: after.createTime } },
                    { createTime: after.createTime, id: { lt: after.id } },
                  ],
                },
              ]
            : []),
          ...(boundary
            ? [
                {
                  OR: [
                    { createTime: { lt: boundary.createTime } },
                    { createTime: boundary.createTime, id: { lte: boundary.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      select: { id: true },
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
    const targets = await readTicketReviewTargets(
      prisma,
      rows.map((row) => row.id),
    );
    if (targets.length !== rows.length) throw iamAccountDenied();
    return targets;
  }
  async target(principal: IamPrincipal, id: string) {
    await this.qualify(principal);
    return (await readTicketReviewTargets(prisma, [id]))[0] ?? null;
  }
  async recheck(principal: IamPrincipal, expected: readonly TicketReviewReadTarget[]) {
    await this.qualify(principal);
    sameTicketReviewTargets(
      await readTicketReviewTargets(
        prisma,
        expected.map((row) => row.id),
      ),
      expected,
    );
  }
  async hydrate(principal: IamPrincipal, expected: readonly TicketReviewReadTarget[]) {
    if (!expected.length) return [];
    return prisma.$transaction(
      async (tx) => {
        await this.qualify(principal, tx);
        sameTicketReviewTargets(
          await readTicketReviewTargets(
            tx,
            expected.map((row) => row.id),
            true,
          ),
          expected,
        );
        const rows = await tx.ticket.findMany({
          where: { status: 1, id: { in: expected.map((row) => row.id) } },
          include: {
            user: { select: { id: true, username: true } },
            assignee: { select: { id: true, username: true } },
          },
        });
        if (rows.length !== expected.length) throw iamAccountDenied();
        sameTicketReviewTargets(
          await readTicketReviewTargets(
            tx,
            expected.map((row) => row.id),
          ),
          expected,
        );
        await this.qualify(principal, tx);
        return rows;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async comments(principal: IamPrincipal, target: TicketReviewReadTarget) {
    await this.qualify(principal);
    sameTicketReviewTargets(await readTicketReviewTargets(prisma, [target.id]), [target]);
    return readTicketReviewCommentTargets(prisma, target);
  }
  async detail(
    principal: IamPrincipal,
    target: TicketReviewReadTarget,
    comments: readonly TicketReviewCommentTarget[],
  ) {
    return prisma.$transaction(
      async (tx) => {
        await this.qualify(principal, tx);
        sameTicketReviewTargets(await readTicketReviewTargets(tx, [target.id], true), [target]);
        sameTicketReviewComments(await readTicketReviewCommentTargets(tx, target, true), comments);
        const ticket = await tx.ticket.findFirst({
          where: { id: target.id, userId: target.userId, status: 1 },
          include: {
            user: { select: { id: true, username: true } },
            assignee: { select: { id: true, username: true } },
          },
        });
        if (!ticket) throw iamAccountDenied();
        const rows = await tx.ticketComment.findMany({
          where: { ticketId: target.id, status: 1 },
          include: { author: { select: { id: true, username: true } } },
          orderBy: [{ createTime: "asc" }, { id: "asc" }],
        });
        if (rows.length !== comments.length) throw iamAccountDenied();
        sameTicketReviewTargets(await readTicketReviewTargets(tx, [target.id]), [target]);
        sameTicketReviewComments(await readTicketReviewCommentTargets(tx, target), comments);
        await this.qualify(principal, tx);
        return { ticket, comments: rows };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

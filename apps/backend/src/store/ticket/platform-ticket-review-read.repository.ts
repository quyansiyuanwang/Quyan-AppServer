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
// Content remains in MySQL until its resource has been authorized. Related display identities are part of the revision.
export const ticketReviewRevision = Prisma.sql`SHA2(CAST(JSON_ARRAY(t.id,t.status,t.createTime,t.updateTime,t.userId,t.type,t.title,t.description,t.sourcePage,t.reproduceSteps,t.contactInfo,t.workflowStatus,t.priority,t.assigneeUserId,t.lastReplyAt,u.username,u.status,u.accountOwnerId,a.username,a.status,a.accountOwnerId) AS CHAR),256)`;
const commentRevision = Prisma.sql`SHA2(CAST(JSON_ARRAY(c.id,c.status,c.createTime,c.updateTime,c.ticketId,c.authorUserId,c.visibility,c.content,u.username,u.status,u.accountOwnerId) AS CHAR),256)`;
const hashValid = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const dateValid = (value: unknown) => value instanceof Date && Number.isFinite(value.getTime());
export function validTicketReviewTarget(row: TicketReviewReadTarget) {
  return (
    !!row &&
    isCanonicalTicketId(row.id) &&
    isCanonicalTicketId(row.userId) &&
    row.status === 1 &&
    hashValid(row.revision) &&
    dateValid(row.createTime) &&
    dateValid(row.updateTime) &&
    (row.lastReplyAt === null || dateValid(row.lastReplyAt))
  );
}
export function sameTicketReviewTargets(
  current: readonly TicketReviewReadTarget[],
  expected: readonly TicketReviewReadTarget[],
) {
  if (
    !Array.isArray(current) ||
    current.length !== expected.length ||
    new Set(current.map((row) => row.id)).size !== current.length ||
    current.some(
      (row) =>
        !validTicketReviewTarget(row) ||
        !expected.some(
          (previous) => previous.id === row.id && previous.userId === row.userId && previous.revision === row.revision,
        ),
    )
  )
    throw iamAccountDenied();
}
export function sameTicketReviewComments(
  current: readonly TicketReviewCommentTarget[],
  expected: readonly TicketReviewCommentTarget[],
) {
  if (
    !Array.isArray(current) ||
    current.length !== expected.length ||
    new Set(current.map((row) => row.id)).size !== current.length ||
    current.some(
      (row) =>
        !isCanonicalTicketId(row.id) ||
        !hashValid(row.revision) ||
        !expected.some((previous) => previous.id === row.id && previous.revision === row.revision),
    )
  )
    throw iamAccountDenied();
}
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
    if (!isCanonicalTicketId(cursor.id) || !dateValid(cursor.createTime)) throw iamAccountDenied();
  }
  private targets(tx: Prisma.TransactionClient, ids: readonly string[], lock = false) {
    if (!ids.length) return Promise.resolve([]);
    if (
      ids.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !isCanonicalTicketId(id))
    )
      throw iamAccountDenied();
    return tx.$queryRaw<TicketReviewReadTarget[]>(
      Prisma.sql`SELECT t.id,t.status,t.userId,t.createTime,t.updateTime,t.lastReplyAt,${ticketReviewRevision} AS revision FROM tickets t JOIN users u ON u.id=t.userId LEFT JOIN users a ON a.id=t.assigneeUserId WHERE t.status=1 AND t.id IN (${Prisma.join(ids)}) ORDER BY t.createTime DESC,t.id DESC ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`,
    );
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
    const targets = await this.targets(
      prisma,
      rows.map((row) => row.id),
    );
    if (targets.length !== rows.length) throw iamAccountDenied();
    return targets;
  }
  async target(principal: IamPrincipal, id: string) {
    await this.qualify(principal);
    return (await this.targets(prisma, [id]))[0] ?? null;
  }
  async recheck(principal: IamPrincipal, expected: readonly TicketReviewReadTarget[]) {
    await this.qualify(principal);
    sameTicketReviewTargets(
      await this.targets(
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
          await this.targets(
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
          await this.targets(
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
  private commentTargets(tx: Prisma.TransactionClient, target: TicketReviewReadTarget, lock = false) {
    if (!validTicketReviewTarget(target)) throw iamAccountDenied();
    return tx.$queryRaw<TicketReviewCommentTarget[]>(
      Prisma.sql`SELECT c.id,${commentRevision} AS revision FROM ticket_comments c JOIN users u ON u.id=c.authorUserId WHERE c.ticketId=${target.id} AND c.status=1 ORDER BY c.id ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`,
    );
  }
  async comments(principal: IamPrincipal, target: TicketReviewReadTarget) {
    await this.qualify(principal);
    sameTicketReviewTargets(await this.targets(prisma, [target.id]), [target]);
    return this.commentTargets(prisma, target);
  }
  async detail(
    principal: IamPrincipal,
    target: TicketReviewReadTarget,
    comments: readonly TicketReviewCommentTarget[],
  ) {
    return prisma.$transaction(
      async (tx) => {
        await this.qualify(principal, tx);
        sameTicketReviewTargets(await this.targets(tx, [target.id], true), [target]);
        sameTicketReviewComments(await this.commentTargets(tx, target, true), comments);
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
        sameTicketReviewTargets(await this.targets(tx, [target.id]), [target]);
        sameTicketReviewComments(await this.commentTargets(tx, target), comments);
        await this.qualify(principal, tx);
        return { ticket, comments: rows };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

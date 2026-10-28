import { Prisma } from "@prisma/client";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isCanonicalTicketId } from "@/iam/resources/ticket-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import type { TicketReviewReadTarget, TicketReviewCommentTarget } from "./platform-ticket-review-read.store";
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
export function readTicketReviewTargets(tx: Prisma.TransactionClient, ids: readonly string[], lock = false) {
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
export function readTicketReviewCommentTargets(
  tx: Prisma.TransactionClient,
  target: TicketReviewReadTarget,
  lock = false,
) {
  if (!validTicketReviewTarget(target)) throw iamAccountDenied();
  return tx.$queryRaw<TicketReviewCommentTarget[]>(
    Prisma.sql`SELECT c.id,${commentRevision} AS revision FROM ticket_comments c JOIN users u ON u.id=c.authorUserId WHERE c.ticketId=${target.id} AND c.status=1 ORDER BY c.id ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`,
  );
}

import type { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import type { PlatformCollectionCursor, PlatformCollectionTarget } from "../system/platform-collection.store";
import type { TicketListFilters, TicketWithRelations, OwnTicketDetail } from "./ticket.store";
export interface TicketReviewReadTarget extends PlatformCollectionTarget {
  userId: string;
  lastReplyAt: Date | null;
  revision: string;
}
export interface TicketReviewCommentTarget {
  id: string;
  revision: string;
}
export interface PlatformTicketReviewReadStore {
  where(filters: TicketListFilters): Promise<Prisma.TicketWhereInput>;
  scan(
    principal: IamPrincipal,
    where: Prisma.TicketWhereInput,
    after?: PlatformCollectionCursor,
    boundary?: PlatformCollectionCursor,
  ): Promise<TicketReviewReadTarget[]>;
  target(principal: IamPrincipal, id: string): Promise<TicketReviewReadTarget | null>;
  recheck(principal: IamPrincipal, expected: readonly TicketReviewReadTarget[]): Promise<void>;
  hydrate(principal: IamPrincipal, expected: readonly TicketReviewReadTarget[]): Promise<TicketWithRelations[]>;
  comments(principal: IamPrincipal, target: TicketReviewReadTarget): Promise<TicketReviewCommentTarget[]>;
  detail(
    principal: IamPrincipal,
    target: TicketReviewReadTarget,
    comments: readonly TicketReviewCommentTarget[],
  ): Promise<OwnTicketDetail>;
}

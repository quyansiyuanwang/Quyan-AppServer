import crypto from "crypto";
import { Decimal } from "@prisma/client/runtime/library";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/util/errors";
import { parseAllowedChannels } from "@/util/monthly-pass.util";
import {
  applyBalanceAccountMutation,
  lockBalanceAccount,
  lockBalanceAccounts,
} from "@/store/billing/balance-account-mutation";
import { CarpoolRepository, type CarpoolOrderRecord, carpoolOrderInclude } from "@/store/billing/carpool.repository";
import type {
  AllocateCarpoolRatiosRequest,
  CarpoolAllocationMode,
  CarpoolDeliveryChannelListResponse,
  CarpoolMemberDto,
  CarpoolOrderDto,
  CarpoolPackageTemplateDto,
  CreateCarpoolOrderRequest,
  CreateCarpoolPackageTemplateRequest,
  UpdateCarpoolPackageTemplateRequest,
} from "@/api/dto/billing/carpool.dto";
import type { Prisma } from "@prisma/client";

const HUNDRED = new Decimal(100);
const ZERO = new Decimal(0);
const round4 = (value: Decimal.Value) => new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
const round6 = (value: Decimal.Value) => new Decimal(value).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
const tokenHash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const active = (member: { state: string }) => member.state !== "left";

export class CarpoolService {
  private static instance: CarpoolService;
  private readonly repository = CarpoolRepository.getInstance();
  static getInstance() {
    return (this.instance ??= new CarpoolService());
  }

  private packageDto(item: any, includeOperations = false): CarpoolPackageTemplateDto {
    const maxMembers = Math.max(1, item.maxMembers);
    const salePrice = Number(item.salePrice);
    const upstreamCost = Number(item.upstreamCost);
    return {
      id: item.id,
      name: item.name,
      description: item.description ?? undefined,
      salePrice,
      ...(includeOperations ? { upstreamCost } : {}),
      maxMembers,
      formationDeadlineHours: item.formationDeadlineHours ?? 72,
      monthlyPassTemplateId: item.monthlyPassTemplateId,
      publishStatus: item.publishStatus,
      snapshotQuota: Number(item.snapshotQuota),
      snapshotQuotaUnit: item.snapshotQuotaUnit ?? "amount",
      snapshotQuotaWindowHours: item.snapshotQuotaWindowHours ?? undefined,
      snapshotValidityDays: item.snapshotValidityDays,
      estimatedSeatPrice: Number(round4(new Decimal(salePrice).div(maxMembers))),
      ...(includeOperations
        ? {
            estimatedSeatCost: Number(round4(new Decimal(upstreamCost).div(maxMembers))),
            estimatedGrossMargin: Number(round4(new Decimal(salePrice).minus(upstreamCost))),
          }
        : {}),
    };
  }

  private dto(order: CarpoolOrderRecord, viewerUserId?: string, isAdmin = false): CarpoolOrderDto {
    const members: CarpoolMemberDto[] = order.members.map((member) => ({
      id: member.id,
      userId: member.userId,
      username: member.user.username,
      role: member.role,
      state: member.state,
      paymentRatio: Number(member.paymentRatio),
      quotaRatio: Number(member.quotaRatio),
      payableAmount: Number(member.payableAmount),
      finalQuota: Number(member.finalQuota),
      reservedAmount: member.reservation?.state === "reserved" ? Number(member.reservation.amount) : 0,
      confirmedAt: member.confirmedAt ?? undefined,
      leftAt: member.leftAt ?? undefined,
      relayTokenId: member.relayToken?.id,
      userMonthlyPassId: member.userMonthlyPass?.id,
    }));
    const activeMembers = members.filter(active);
    const ownMember = viewerUserId
      ? members.find((member) => member.userId === viewerUserId && active(member))
      : undefined;
    const formationDeadline = order.formationDeadlineAt ?? order.inviteExpiresAt;
    const open = order.state === "open" && (!formationDeadline || formationDeadline > new Date());
    const viewerActions = viewerUserId
      ? {
          canInvite: open && order.ownerUserId === viewerUserId,
          canAllocate: open && order.ownerUserId === viewerUserId,
          canConfirm: open && ownMember?.state === "pending",
          canLeave: open && ownMember?.role !== "owner" && ownMember?.state === "pending",
          canCancel: open && order.ownerUserId === viewerUserId,
          canSubmit:
            open &&
            order.ownerUserId === viewerUserId &&
            activeMembers.length > 0 &&
            activeMembers.every((member) => member.state === "confirmed") &&
            activeMembers.reduce((sum, member) => sum.plus(member.paymentRatio), ZERO).equals(HUNDRED) &&
            activeMembers.reduce((sum, member) => sum.plus(member.quotaRatio), ZERO).equals(HUNDRED),
          ...(open
            ? {}
            : {
                reason: order.state === "open" ? "Carpool formation deadline has passed" : "Carpool is no longer open",
              }),
        }
      : undefined;
    return {
      id: order.id,
      state: order.state as CarpoolOrderDto["state"],
      allocationMode: order.allocationMode as CarpoolAllocationMode,
      packageName: order.packageName,
      monthlyPassTemplateId: order.monthlyPassTemplateId ?? undefined,
      salePrice: Number(order.salePrice),
      ...(isAdmin ? { upstreamCost: Number(order.upstreamCost) } : {}),
      totalQuota: Number(order.totalQuota),
      quotaUnit: order.quotaUnit,
      quotaWindowHours: order.quotaWindowHours ?? undefined,
      validityDays: order.validityDays,
      maxMembers: order.maxMembers,
      formationDeadlineAt: order.formationDeadlineAt ?? order.inviteExpiresAt ?? undefined,
      submittedAt: order.submittedAt ?? undefined,
      acceptedAt: order.acceptedAt ?? undefined,
      fulfilledAt: order.fulfilledAt ?? undefined,
      failedAt: order.failedAt ?? undefined,
      cancelledAt: order.cancelledAt ?? undefined,
      expiredAt: order.expiredAt ?? undefined,
      failureReason: order.failureReason ?? undefined,
      relayChannelId: order.relayChannelId ?? undefined,
      relayChannelName: order.relayChannel?.name ?? undefined,
      members,
      events: order.events.map((event) => ({
        id: event.id,
        type: event.type,
        actorUserId: event.actorUserId ?? undefined,
        createTime: event.createTime,
        metadata: (event.metadata as Record<string, unknown> | null) ?? undefined,
      })),
      paymentRatioTotal: activeMembers.reduce((sum, item) => sum + item.paymentRatio, 0),
      quotaRatioTotal: activeMembers.reduce((sum, item) => sum + item.quotaRatio, 0),
      activeMemberCount: activeMembers.length,
      allConfirmed: activeMembers.length > 0 && activeMembers.every((item) => item.state === "confirmed"),
      viewerActions,
    };
  }

  private owner(order: { ownerUserId: string }, userId: string) {
    if (order.ownerUserId !== userId) throw new ForbiddenError("Only the carpool initiator can perform this action");
  }
  private ensureOpen(order: { state: string; formationDeadlineAt?: Date | null; inviteExpiresAt?: Date | null }) {
    if (order.state !== "open") throw new BadRequestError("Carpool is no longer open");
    const deadline = order.formationDeadlineAt ?? order.inviteExpiresAt;
    if (deadline && deadline <= new Date()) throw new BadRequestError("Carpool formation deadline has passed");
  }
  private async event(
    tx: Prisma.TransactionClient,
    orderId: string,
    type: string,
    actorUserId?: string,
    metadata?: object,
  ) {
    await tx.carpoolOrderEvent.create({
      data: { orderId, type, actorUserId, metadata: metadata as Prisma.InputJsonValue | undefined },
    });
  }
  private async releaseReservations(tx: Prisma.TransactionClient, orderId: string) {
    await tx.balanceReservation.updateMany({ where: { orderId, state: "reserved" }, data: { state: "released" } });
  }
  private async resetConfirmations(tx: Prisma.TransactionClient, orderId: string) {
    await this.releaseReservations(tx, orderId);
    await tx.carpoolMember.updateMany({
      where: { orderId, state: { not: "left" } },
      data: { state: "pending", confirmedAt: null },
    });
  }
  private async rebalanceEqual(tx: Prisma.TransactionClient, orderId: string) {
    const members = await tx.carpoolMember.findMany({
      where: { orderId, state: { not: "left" } },
      orderBy: { createTime: "asc" },
    });
    if (!members.length) return;
    const order = await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId } });
    await this.resetConfirmations(tx, orderId);
    let paymentRemaining = HUNDRED;
    let quotaRemaining = HUNDRED;
    for (const [index, member] of members.entries()) {
      const last = index === members.length - 1;
      const paymentRatio = last ? paymentRemaining : round6(HUNDRED.div(members.length));
      const quotaRatio = last ? quotaRemaining : round6(HUNDRED.div(members.length));
      paymentRemaining = paymentRemaining.minus(paymentRatio);
      quotaRemaining = quotaRemaining.minus(quotaRatio);
      await tx.carpoolMember.update({
        where: { id: member.id },
        data: {
          paymentRatio,
          quotaRatio,
          payableAmount: round4(new Decimal(order.salePrice).mul(paymentRatio).div(HUNDRED)),
          finalQuota: round4(new Decimal(order.totalQuota).mul(quotaRatio).div(HUNDRED)),
          state: "pending",
          confirmedAt: null,
        },
      });
    }
  }

  async listPublishedTemplates() {
    return (await this.repository.findPublishedTemplates()).map((item) => this.packageDto(item));
  }
  async listCatalog(page = 1, pageSize = 20, keyword?: string) {
    const [total, records] = await this.repository.findTemplates(
      Math.max(1, page),
      Math.min(100, Math.max(1, pageSize)),
      keyword,
      undefined,
      true,
    );
    return { total, records: records.map((item) => this.packageDto(item)) };
  }
  async listTemplates(page = 1, pageSize = 20, keyword?: string, publishStatus?: string) {
    const [total, records] = await this.repository.findTemplates(
      Math.max(1, page),
      Math.min(100, Math.max(1, pageSize)),
      keyword,
      publishStatus,
    );
    return { total, records: records.map((item) => this.packageDto(item, true)) };
  }
  private async templateData(data: CreateCarpoolPackageTemplateRequest | UpdateCarpoolPackageTemplateRequest) {
    const monthly = await this.repository.findActiveMonthlyPassTemplate(data.monthlyPassTemplateId);
    if (!monthly) throw new NotFoundError("Monthly pass template not found");
    return {
      ...data,
      formationDeadlineHours: data.formationDeadlineHours ?? 72,
      salePrice: round4(data.salePrice),
      upstreamCost: round4(data.upstreamCost),
      snapshotQuota: monthly.defaultQuota,
      snapshotValidityDays: monthly.validityDays,
      snapshotQuotaUnit: monthly.quotaUnit,
      snapshotQuotaWindowHours: monthly.quotaWindowHours,
      snapshotAllowedModels: monthly.allowedModels,
      snapshotAllowedChannels: monthly.allowedChannels,
    };
  }
  async createTemplate(data: CreateCarpoolPackageTemplateRequest) {
    return this.packageDto(await this.repository.createTemplate(await this.templateData(data)), true);
  }
  async updateTemplate(id: string, data: UpdateCarpoolPackageTemplateRequest) {
    if (!(await this.repository.findTemplate(id))) throw new NotFoundError("Carpool package template not found");
    return this.packageDto(await this.repository.updateTemplate(id, await this.templateData(data)), true);
  }
  async duplicateTemplate(id: string) {
    const template = await this.repository.findTemplate(id);
    if (!template) throw new NotFoundError("Carpool package template not found");
    return this.packageDto(
      await this.repository.createTemplate({
        ...template,
        id: undefined,
        name: `${template.name} Copy ${Date.now().toString().slice(-6)}`,
        publishStatus: "draft",
        publishedAt: null,
        status: 1,
        createTime: undefined,
        updateTime: undefined,
      }),
      true,
    );
  }
  async archiveTemplate(id: string) {
    if (!(await this.repository.findTemplate(id))) throw new NotFoundError("Carpool package template not found");
    await this.repository.archiveTemplate(id);
  }
  async publishTemplate(id: string, published: boolean) {
    if (!(await this.repository.findTemplate(id))) throw new NotFoundError("Carpool package template not found");
    return this.packageDto(await this.repository.updateTemplatePublication(id, published), true);
  }

  async createOrder(data: CreateCarpoolOrderRequest, userId: string) {
    const template = await this.repository.findPublishedTemplate(data.packageTemplateId);
    if (!template) throw new NotFoundError("Carpool package template not found");
    const deadline = new Date(Date.now() + (template.formationDeadlineHours ?? 72) * 3600000);
    const order = await this.repository.withTransaction(async (tx) => {
      const created = await tx.carpoolOrder.create({
        data: {
          ownerUserId: userId,
          packageTemplateId: template.id,
          monthlyPassTemplateId: template.monthlyPassTemplateId,
          packageName: template.name,
          salePrice: template.salePrice,
          upstreamCost: template.upstreamCost,
          maxMembers: template.maxMembers,
          totalQuota: template.snapshotQuota,
          validityDays: template.snapshotValidityDays,
          quotaUnit: template.snapshotQuotaUnit,
          quotaWindowHours: template.snapshotQuotaWindowHours,
          allowedModels: template.snapshotAllowedModels,
          allowedChannels: template.snapshotAllowedChannels,
          allocationMode: "equal",
          formationDeadlineAt: deadline,
        },
      });
      await tx.carpoolMember.create({ data: { orderId: created.id, userId, role: "owner", state: "pending" } });
      await this.rebalanceEqual(tx, created.id);
      await this.event(tx, created.id, "created", userId, { formationDeadlineAt: deadline.toISOString() });
      return tx.carpoolOrder.findUniqueOrThrow({ where: { id: created.id }, include: carpoolOrderInclude });
    });
    return this.dto(order, userId);
  }
  async getOrder(id: string, userId: string, admin = false) {
    const order = await this.repository.findOrder(id);
    if (!order) throw new NotFoundError("Carpool order not found");
    if (!admin && !order.members.some((member) => member.userId === userId)) throw new ForbiddenError();
    return this.dto(order, admin ? undefined : userId, admin);
  }
  async listMine(userId: string, page = 1, pageSize = 20, state?: string, keyword?: string) {
    const [total, records] = await this.repository.findOrdersForUser(
      userId,
      Math.max(1, page),
      Math.min(100, Math.max(1, pageSize)),
      state,
      keyword,
    );
    return { total, records: records.map((item) => this.dto(item, userId)) };
  }
  async listAdmin(state?: string, page = 1, pageSize = 20, keyword?: string) {
    const [orderPage, groupedCounts] = await Promise.all([
      this.repository.findOrdersForAdmin(state, Math.max(1, page), Math.min(100, Math.max(1, pageSize)), keyword),
      this.repository.countAdminOrdersByState(keyword),
    ]);
    const [total, records] = orderPage;
    return {
      total,
      records: records.map((item) => this.dto(item, undefined, true)),
      stateCounts: Object.fromEntries(groupedCounts.map((item) => [item.state, item._count._all])),
    };
  }

  async invite(orderId: string, userId: string, hours = 72) {
    const order = await this.repository.findOrder(orderId);
    if (!order) throw new NotFoundError("Carpool order not found");
    this.owner(order, userId);
    this.ensureOpen(order);
    const deadline = order.formationDeadlineAt ?? order.inviteExpiresAt;
    const expiresAt = new Date(Math.min(Date.now() + hours * 3600000, deadline?.getTime() ?? Number.MAX_SAFE_INTEGER));
    const token = crypto.randomBytes(32).toString("base64url");
    await this.repository.withTransaction(async (tx) => {
      await tx.carpoolInvite.create({
        data: { orderId, createdByUserId: userId, tokenHash: tokenHash(token), expiresAt },
      });
      await this.event(tx, orderId, "invite_created", userId, { expiresAt: expiresAt.toISOString() });
    });
    return { token, expiresAt };
  }
  async acceptInvite(token: string, userId: string) {
    return this.repository.withTransaction(async (tx) => {
      const invite = await tx.carpoolInvite.findUnique({
        where: { tokenHash: tokenHash(token) },
        include: { order: { include: { members: true } } },
      });
      if (!invite || invite.revokedAt || invite.usedAt || invite.expiresAt <= new Date())
        throw new BadRequestError("Carpool invitation is invalid or expired");
      this.ensureOpen(invite.order);
      const current = invite.order.members.find((member) => member.userId === userId);
      const activeCount = invite.order.members.filter(active).length;
      if (!current && activeCount >= invite.order.maxMembers) throw new BadRequestError("Carpool is already full");
      if (current && current.state !== "left") throw new BadRequestError("You have already joined this carpool");
      await tx.carpoolInvite.update({ where: { id: invite.id }, data: { usedByUserId: userId, usedAt: new Date() } });
      if (current) {
        await tx.carpoolMember.update({
          where: { id: current.id },
          data: { state: "pending", leftAt: null, confirmedAt: null },
        });
      } else {
        await tx.carpoolMember.create({ data: { orderId: invite.orderId, userId, role: "member", state: "pending" } });
      }
      if (invite.order.allocationMode === "equal") await this.rebalanceEqual(tx, invite.orderId);
      else await this.resetConfirmations(tx, invite.orderId);
      await this.event(tx, invite.orderId, current ? "member_rejoined" : "member_joined", userId);
      return this.dto(
        await tx.carpoolOrder.findUniqueOrThrow({ where: { id: invite.orderId }, include: carpoolOrderInclude }),
        userId,
      );
    });
  }
  async allocate(orderId: string, data: AllocateCarpoolRatiosRequest, userId: string) {
    return this.repository.withTransaction(async (tx) => {
      const order = await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId }, include: { members: true } });
      this.owner(order, userId);
      this.ensureOpen(order);
      const allocationMode = data.allocationMode ?? "custom";

      // Equal mode is deliberately server-authoritative. Do not trust or reuse ratios
      // supplied by a client: a member join/leave or a switch back from custom must
      // always split every active member evenly and invalidate stale confirmations.
      if (allocationMode === "equal") {
        await tx.carpoolOrder.update({ where: { id: orderId }, data: { allocationMode } });
        await this.rebalanceEqual(tx, orderId);
        await this.event(tx, orderId, "allocation_updated", userId, { allocationMode });
        return this.dto(
          await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId }, include: carpoolOrderInclude }),
          userId,
        );
      }

      const members = order.members.filter(active);
      const provided = new Map((data.members ?? []).map((member) => [member.memberId, member]));
      if (provided.size !== members.length || members.some((member) => !provided.has(member.id)))
        throw new BadRequestError("All active members must be assigned exactly once");
      const paymentTotal = members.reduce((sum, member) => sum.plus(provided.get(member.id)!.paymentRatio), ZERO);
      const quotaTotal = members.reduce((sum, member) => sum.plus(provided.get(member.id)!.quotaRatio), ZERO);
      if (!paymentTotal.equals(HUNDRED) || !quotaTotal.equals(HUNDRED))
        throw new BadRequestError("Payment and quota ratios must each total 100");
      await this.resetConfirmations(tx, orderId);
      for (const member of members) {
        const ratio = provided.get(member.id)!;
        await tx.carpoolMember.update({
          where: { id: member.id },
          data: {
            paymentRatio: ratio.paymentRatio,
            quotaRatio: ratio.quotaRatio,
            payableAmount: round4(new Decimal(order.salePrice).mul(ratio.paymentRatio).div(HUNDRED)),
            finalQuota: round4(new Decimal(order.totalQuota).mul(ratio.quotaRatio).div(HUNDRED)),
          },
        });
      }
      await tx.carpoolOrder.update({ where: { id: orderId }, data: { allocationMode } });
      await this.event(tx, orderId, "allocation_updated", userId, { allocationMode });
      return this.dto(
        await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId }, include: carpoolOrderInclude }),
        userId,
      );
    });
  }
  async confirm(orderId: string, userId: string) {
    return this.repository.withTransaction(async (tx) => {
      const member = await tx.carpoolMember.findUnique({
        where: { orderId_userId: { orderId, userId } },
        include: { order: true, reservation: true },
      });
      if (!member || member.state === "left") throw new NotFoundError("Carpool member not found");
      this.ensureOpen(member.order);
      if (member.state !== "pending") throw new BadRequestError("Carpool share is already confirmed");
      await lockBalanceAccount(tx, userId, true);
      const balance = await tx.balanceAccount.findUnique({ where: { userId } });
      if (!balance || balance.balance.lessThan(member.payableAmount))
        throw new BadRequestError("Insufficient balance for your carpool share");
      await tx.balanceReservation.upsert({
        where: { memberId: member.id },
        create: { memberId: member.id, orderId, userId, amount: member.payableAmount, state: "reserved" },
        update: { amount: member.payableAmount, state: "reserved" },
      });
      await tx.carpoolMember.update({
        where: { id: member.id },
        data: { state: "confirmed", confirmedAt: new Date() },
      });
      await this.event(tx, orderId, "member_confirmed", userId);
      return this.dto(
        await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId }, include: carpoolOrderInclude }),
        userId,
      );
    });
  }
  async leave(orderId: string, userId: string) {
    return this.repository.withTransaction(async (tx) => {
      const member = await tx.carpoolMember.findUnique({
        where: { orderId_userId: { orderId, userId } },
        include: { order: true, reservation: true },
      });
      if (!member || member.state === "left") throw new NotFoundError("Carpool member not found");
      this.ensureOpen(member.order);
      if (member.role === "owner") throw new BadRequestError("Initiator must cancel the carpool instead");
      if (member.state === "confirmed")
        throw new BadRequestError("Confirmed members cannot leave; ask the initiator to change the allocation first");
      if (member.reservation?.state === "reserved")
        await tx.balanceReservation.update({ where: { id: member.reservation.id }, data: { state: "released" } });
      await tx.carpoolMember.update({
        where: { id: member.id },
        data: { state: "left", leftAt: new Date(), confirmedAt: null },
      });
      if (member.order.allocationMode === "equal") await this.rebalanceEqual(tx, orderId);
      else await this.resetConfirmations(tx, orderId);
      await this.event(tx, orderId, "member_left", userId);
      return this.dto(
        await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId }, include: carpoolOrderInclude }),
        userId,
      );
    });
  }
  async cancel(orderId: string, userId: string) {
    return this.repository.withTransaction(async (tx) => {
      const order = await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId } });
      this.owner(order, userId);
      this.ensureOpen(order);
      await this.releaseReservations(tx, orderId);
      await tx.carpoolOrder.update({ where: { id: orderId }, data: { state: "cancelled", cancelledAt: new Date() } });
      await this.event(tx, orderId, "cancelled", userId);
      return this.dto(
        await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId }, include: carpoolOrderInclude }),
        userId,
      );
    });
  }
  async submit(orderId: string, userId: string) {
    return this.repository.withTransaction(async (tx) => {
      const order = await tx.carpoolOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: { members: { include: { reservation: true } } },
      });
      this.owner(order, userId);
      this.ensureOpen(order);
      const members = order.members.filter(active);
      if (
        !members.length ||
        !members.every((member) => member.state === "confirmed" && member.reservation?.state === "reserved")
      )
        throw new BadRequestError("All active members must confirm and reserve their own share");
      if (
        !members.reduce((sum, member) => sum.plus(member.paymentRatio), ZERO).equals(HUNDRED) ||
        !members.reduce((sum, member) => sum.plus(member.quotaRatio), ZERO).equals(HUNDRED)
      )
        throw new BadRequestError("Payment and quota ratios must each total 100");
      await lockBalanceAccounts(
        tx,
        members.map((member) => ({ userId: member.userId, createIfMissing: true })),
      );
      for (const member of members) {
        const reservation = member.reservation!;
        const mutation = await applyBalanceAccountMutation(tx, {
          userId: member.userId,
          balanceDelta: reservation.amount.negated(),
          totalUsedDelta: reservation.amount,
          minimumBalance: 0,
        });
        if (!mutation) throw new BadRequestError("Balance changed; member needs to reconfirm");
        await tx.balanceTransaction.create({
          data: {
            userId: member.userId,
            type: "carpool_capture",
            amount: reservation.amount.negated(),
            balanceBefore: mutation.balanceBefore,
            balanceAfter: mutation.balanceAfter,
            relatedId: orderId,
            description: "Carpool departure",
            model: "carpool",
          },
        });
        await tx.balanceReservation.update({ where: { id: reservation.id }, data: { state: "captured" } });
      }
      await tx.carpoolOrder.update({ where: { id: orderId }, data: { state: "submitted", submittedAt: new Date() } });
      await this.event(tx, orderId, "submitted", userId);
      return this.dto(
        await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId }, include: carpoolOrderInclude }),
        userId,
      );
    });
  }
  async accept(orderId: string, actorUserId?: string) {
    return this.repository.withTransaction(async (tx) => {
      const order = await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId } });
      if (order.state !== "submitted") throw new BadRequestError("Carpool has not been submitted");
      await tx.carpoolOrder.update({ where: { id: orderId }, data: { state: "accepted", acceptedAt: new Date() } });
      await this.event(tx, orderId, "accepted", actorUserId);
      return this.dto(
        await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId }, include: carpoolOrderInclude }),
        undefined,
        true,
      );
    });
  }
  async listDeliveryChannels(
    page = 1,
    pageSize = 20,
    keyword?: string,
    orderId?: string,
  ): Promise<CarpoolDeliveryChannelListResponse> {
    let allowedChannelIds: string[] | undefined;
    if (orderId) {
      const order = await this.repository.findOrderSummary(orderId);
      if (!order) throw new NotFoundError("Carpool order not found");
      if (order.state !== "accepted")
        throw new BadRequestError("Carpool must be accepted before selecting a delivery channel");
      allowedChannelIds = parseAllowedChannels(order.allowedChannels) ?? undefined;
    }
    const [total, records] = await this.repository.listEligibleDeliveryChannels(
      Math.max(1, page),
      Math.min(100, Math.max(1, pageSize)),
      keyword,
      allowedChannelIds,
    );
    return { total, records: records.map((item) => ({ id: item.id, name: item.name, channelType: item.channelType })) };
  }
  async fulfill(orderId: string, relayChannelId: string, actorUserId?: string) {
    return this.repository.withTransaction(async (tx) => {
      const order = await tx.carpoolOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: { members: true, packageTemplate: true },
      });
      if (order.state !== "accepted") throw new BadRequestError("Carpool must be accepted before fulfillment");
      const allowedChannelIds = parseAllowedChannels(order.allowedChannels);
      if (allowedChannelIds?.length && !allowedChannelIds.includes(relayChannelId))
        throw new BadRequestError("Relay channel is not allowed by the carpool package snapshot");
      // Revalidate all delivery eligibility inside the serializable fulfillment transaction.
      const channel = await tx.relayChannel.findFirst({
        where: { id: relayChannelId, status: 1, providerServiceEnabled: true, submissionStatus: "approved" },
      });
      if (!channel) throw new NotFoundError("Eligible relay channel not found");
      const templateId = order.monthlyPassTemplateId ?? order.packageTemplate.monthlyPassTemplateId;
      const template = await tx.monthlyPassTemplate.findUnique({ where: { id: templateId } });
      // The order's quota, validity, model and channel constraints are immutable snapshots.
      // A later template unpublish/disable must not make an already accepted order undeliverable.
      if (!template) throw new BadRequestError("Carpool monthly pass template no longer exists");
      const now = new Date();
      const endAt = new Date(now.getTime() + order.validityDays * 86400000);
      for (const member of order.members.filter(active)) {
        const pass = await tx.userMonthlyPass.create({
          data: {
            userId: member.userId,
            templateId: template.id,
            startAt: now,
            endAt,
            totalQuota: member.finalQuota,
            remainingQuota: member.finalQuota,
            quotaUnit: order.quotaUnit,
            quotaWindowHours: order.quotaWindowHours,
            note: "Carpool delivery",
            status: 1,
          },
        });
        await tx.relayToken.create({
          data: {
            userId: member.userId,
            carpoolMemberId: member.id,
            name: `Carpool ${order.packageName}`,
            token: `rlt_${crypto.randomBytes(24).toString("hex")}`,
            channelId: relayChannelId,
            quotaLimit: member.finalQuota,
            allowedModels: order.allowedModels,
          },
        });
        await tx.carpoolMember.update({
          where: { id: member.id },
          data: { userMonthlyPassId: pass.id, state: "delivered" },
        });
      }
      await tx.carpoolOrder.update({
        where: { id: orderId },
        data: { state: "fulfilled", relayChannelId, fulfilledAt: now },
      });
      await this.event(tx, orderId, "fulfilled", actorUserId, { relayChannelId });
      return this.dto(
        await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId }, include: carpoolOrderInclude }),
        undefined,
        true,
      );
    });
  }
  async fail(orderId: string, reason: string, actorUserId?: string) {
    return this.repository.withTransaction(async (tx) => {
      const order = await tx.carpoolOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: { members: { include: { reservation: true } } },
      });
      if (!(["submitted", "accepted"] as string[]).includes(order.state))
        throw new BadRequestError("Carpool cannot be refunded in its current state");
      const members = order.members.filter(active);
      await lockBalanceAccounts(
        tx,
        members.map((member) => ({ userId: member.userId, createIfMissing: true })),
      );
      for (const member of members) {
        if (member.reservation?.state !== "captured") continue;
        const mutation = await applyBalanceAccountMutation(tx, {
          userId: member.userId,
          balanceDelta: member.reservation.amount,
          totalUsedDelta: member.reservation.amount.negated(),
          createIfMissing: true,
        });
        if (!mutation) throw new BadRequestError("Balance account unavailable");
        await tx.balanceTransaction.create({
          data: {
            userId: member.userId,
            type: "carpool_refund",
            amount: member.reservation.amount,
            balanceBefore: mutation.balanceBefore,
            balanceAfter: mutation.balanceAfter,
            relatedId: orderId,
            description: "Carpool refund",
            model: "carpool",
          },
        });
        await tx.balanceReservation.update({ where: { id: member.reservation.id }, data: { state: "refunded" } });
      }
      await tx.carpoolOrder.update({
        where: { id: orderId },
        data: { state: "failed", failedAt: new Date(), failureReason: reason },
      });
      await this.event(tx, orderId, "failed", actorUserId, { reason });
      return this.dto(
        await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId }, include: carpoolOrderInclude }),
        undefined,
        true,
      );
    });
  }
  /**
   * Carries the legacy order deadline into its dedicated snapshot field.
   *
   * Old deployments used `inviteExpiresAt` as the order formation deadline.
   * The scheduler holds a cluster-wide database lock before invoking this
   * method, and the conditional update keeps a concurrent request from
   * overwriting a newly-created dedicated deadline.
   */
  async backfillOpenOrderFormationDeadlines() {
    while (true) {
      const orders = await this.repository.findOpenOrdersMissingFormationDeadline();
      if (!orders.length) return;
      for (const order of orders) {
        if (order.inviteExpiresAt) {
          await this.repository.backfillFormationDeadline(order.id, order.inviteExpiresAt);
        }
      }
      if (orders.length < 200) return;
    }
  }

  async expireDueOrders() {
    const due = await this.repository.findOpenOrdersDueForExpiry(new Date());
    for (const orderId of due) {
      await this.repository.withTransaction(async (tx) => {
        const order = await tx.carpoolOrder.findUnique({ where: { id: orderId } });
        if (
          !order ||
          order.state !== "open" ||
          !(order.formationDeadlineAt ?? order.inviteExpiresAt) ||
          (order.formationDeadlineAt ?? order.inviteExpiresAt)! > new Date()
        )
          return;
        await this.releaseReservations(tx, orderId);
        await tx.carpoolOrder.update({ where: { id: orderId }, data: { state: "expired", expiredAt: new Date() } });
        await this.event(tx, orderId, "expired");
      });
    }
  }
}

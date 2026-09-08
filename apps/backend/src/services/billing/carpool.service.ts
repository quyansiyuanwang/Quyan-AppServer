import crypto from "crypto";
import { Decimal } from "@prisma/client/runtime/library";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/util/errors";
import {
  applyBalanceAccountMutation,
  lockBalanceAccount,
  lockBalanceAccounts,
} from "@/store/billing/balance-account-mutation";
import { CarpoolRepository, type CarpoolOrderRecord, carpoolOrderInclude } from "@/store/billing/carpool.repository";
import type {
  AllocateCarpoolRatiosRequest,
  CarpoolMemberDto,
  CarpoolOrderDto,
  CarpoolPackageTemplateDto,
  CreateCarpoolOrderRequest,
  CreateCarpoolPackageTemplateRequest,
} from "@/api/dto/billing/carpool.dto";

const HUNDRED = new Decimal(100);
const ZERO = new Decimal(0);
const round4 = (value: Decimal.Value) => new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
const tokenHash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

export class CarpoolService {
  private static instance: CarpoolService;
  private readonly repository = CarpoolRepository.getInstance();
  static getInstance() {
    return (this.instance ??= new CarpoolService());
  }
  private packageDto(item: any): CarpoolPackageTemplateDto {
    return {
      id: item.id,
      name: item.name,
      description: item.description ?? undefined,
      salePrice: Number(item.salePrice),
      upstreamCost: Number(item.upstreamCost),
      maxMembers: item.maxMembers,
      monthlyPassTemplateId: item.monthlyPassTemplateId,
      publishStatus: item.publishStatus,
      snapshotQuota: Number(item.snapshotQuota),
      snapshotValidityDays: item.snapshotValidityDays,
    };
  }
  private dto(order: CarpoolOrderRecord): CarpoolOrderDto {
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
      relayTokenId: member.relayToken?.id,
      userMonthlyPassId: member.userMonthlyPass?.id,
    }));
    return {
      id: order.id,
      state: order.state as CarpoolOrderDto["state"],
      packageName: order.packageName,
      salePrice: Number(order.salePrice),
      totalQuota: Number(order.totalQuota),
      validityDays: order.validityDays,
      maxMembers: order.maxMembers,
      relayChannelId: order.relayChannelId ?? undefined,
      members,
      paymentRatioTotal: members.reduce((sum, item) => sum + item.paymentRatio, 0),
      quotaRatioTotal: members.reduce((sum, item) => sum + item.quotaRatio, 0),
      allConfirmed: members.length > 0 && members.every((item) => item.state === "confirmed"),
    };
  }
  private owner(order: { ownerUserId: string }, userId: string) {
    if (order.ownerUserId !== userId) throw new ForbiddenError("Only the carpool initiator can perform this action");
  }
  private open(order: { state: string }) {
    if (order.state !== "open") throw new BadRequestError("Carpool is no longer open");
  }
  async listPublishedTemplates() {
    return (await this.repository.findPublishedTemplates()).map((item) => this.packageDto(item));
  }
  async listTemplates(page = 1, pageSize = 20) {
    const [total, records] = await this.repository.findTemplates(
      Math.max(1, page),
      Math.min(100, Math.max(1, pageSize)),
    );
    return { total, records: records.map((item) => this.packageDto(item)) };
  }
  async createTemplate(data: CreateCarpoolPackageTemplateRequest) {
    const monthly = await this.repository.findActiveMonthlyPassTemplate(data.monthlyPassTemplateId);
    if (!monthly) throw new NotFoundError("Monthly pass template not found");
    return this.packageDto(
      await this.repository.createTemplate({
        ...data,
        salePrice: round4(data.salePrice),
        upstreamCost: round4(data.upstreamCost),
        snapshotQuota: monthly.defaultQuota,
        snapshotValidityDays: monthly.validityDays,
        snapshotQuotaUnit: monthly.quotaUnit,
        snapshotQuotaWindowHours: monthly.quotaWindowHours,
        snapshotAllowedModels: monthly.allowedModels,
        snapshotAllowedChannels: monthly.allowedChannels,
      }),
    );
  }
  async publishTemplate(id: string, published: boolean) {
    return this.packageDto(await this.repository.updateTemplatePublication(id, published));
  }
  async createOrder(data: CreateCarpoolOrderRequest, userId: string) {
    const template = await this.repository.findPublishedTemplate(data.packageTemplateId);
    if (!template) throw new NotFoundError("Carpool package template not found");
    const order = await this.repository.withTransaction(async (tx) => {
      const created = await tx.carpoolOrder.create({
        data: {
          ownerUserId: userId,
          packageTemplateId: template.id,
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
          inviteExpiresAt: new Date(Date.now() + (data.inviteValidityHours ?? 72) * 3600000),
        },
      });
      await tx.carpoolMember.create({
        data: {
          orderId: created.id,
          userId,
          role: "owner",
          paymentRatio: HUNDRED,
          quotaRatio: HUNDRED,
          payableAmount: template.salePrice,
          finalQuota: template.snapshotQuota,
        },
      });
      return tx.carpoolOrder.findUniqueOrThrow({ where: { id: created.id }, include: carpoolOrderInclude });
    });
    return this.dto(order);
  }
  async getOrder(id: string, userId: string, admin = false) {
    const order = await this.repository.findOrder(id);
    if (!order) throw new NotFoundError("Carpool order not found");
    if (!admin && !order.members.some((m) => m.userId === userId)) throw new ForbiddenError();
    return this.dto(order);
  }
  async listMine(userId: string, page = 1, pageSize = 20) {
    const [total, records] = await this.repository.findOrdersForUser(
      userId,
      Math.max(1, page),
      Math.min(100, Math.max(1, pageSize)),
    );
    return { total, records: records.map((item) => this.dto(item)) };
  }
  async listAdmin(state?: string, page = 1, pageSize = 20) {
    const [total, records] = await this.repository.findOrdersForAdmin(
      state,
      Math.max(1, page),
      Math.min(100, Math.max(1, pageSize)),
    );
    return { total, records: records.map((item) => this.dto(item)) };
  }
  async invite(orderId: string, userId: string, hours = 72) {
    const order = await this.repository.findOrder(orderId);
    if (!order) throw new NotFoundError("Carpool order not found");
    this.owner(order, userId);
    this.open(order);
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + hours * 3600000);
    await this.repository.createInvite({
      order: { connect: { id: orderId } },
      createdBy: { connect: { id: userId } },
      tokenHash: tokenHash(token),
      expiresAt,
    });
    return { token, expiresAt };
  }
  async acceptInvite(token: string, userId: string) {
    return this.repository.withTransaction(async (tx) => {
      const invite = await tx.carpoolInvite.findUnique({
        where: { tokenHash: tokenHash(token) },
        include: { order: { include: { members: true } } },
      });
      if (!invite || invite.revokedAt || invite.expiresAt <= new Date())
        throw new BadRequestError("Carpool invitation is invalid or expired");
      this.open(invite.order);
      if (invite.order.members.length >= invite.order.maxMembers) throw new BadRequestError("Carpool is full");
      if (invite.order.members.some((m) => m.userId === userId))
        throw new BadRequestError("You already joined this carpool");
      await tx.carpoolMember.create({ data: { orderId: invite.orderId, userId } });
      await tx.carpoolInvite.update({ where: { id: invite.id }, data: { usedByUserId: userId, usedAt: new Date() } });
      return this.dto(
        await tx.carpoolOrder.findUniqueOrThrow({ where: { id: invite.orderId }, include: carpoolOrderInclude }),
      );
    });
  }
  async allocate(orderId: string, data: AllocateCarpoolRatiosRequest, userId: string) {
    return this.repository.withTransaction(async (tx) => {
      const order = await tx.carpoolOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: { members: { include: { reservation: true } } },
      });
      this.owner(order, userId);
      this.open(order);
      if (
        data.members.length !== order.members.length ||
        new Set(data.members.map((x) => x.memberId)).size !== order.members.length
      )
        throw new BadRequestError("Ratios must cover every current member");
      const payment = data.members.reduce((sum, x) => sum.plus(x.paymentRatio), ZERO),
        quota = data.members.reduce((sum, x) => sum.plus(x.quotaRatio), ZERO);
      if (!payment.equals(HUNDRED) || !quota.equals(HUNDRED))
        throw new BadRequestError("Payment and quota ratios must each total 100");
      let paid = ZERO,
        quotas = ZERO;
      for (const [index, ratio] of data.members.entries()) {
        const member = order.members.find((x) => x.id === ratio.memberId)!;
        const payable =
          index === data.members.length - 1
            ? round4(new Decimal(order.salePrice).minus(paid))
            : round4(new Decimal(order.salePrice).mul(ratio.paymentRatio).div(HUNDRED));
        const finalQuota =
          index === data.members.length - 1
            ? round4(new Decimal(order.totalQuota).minus(quotas))
            : round4(new Decimal(order.totalQuota).mul(ratio.quotaRatio).div(HUNDRED));
        paid = paid.plus(payable);
        quotas = quotas.plus(finalQuota);
        if (member.reservation?.state === "reserved")
          await tx.balanceReservation.update({ where: { id: member.reservation.id }, data: { state: "released" } });
        await tx.carpoolMember.update({
          where: { id: member.id },
          data: {
            paymentRatio: ratio.paymentRatio,
            quotaRatio: ratio.quotaRatio,
            payableAmount: payable,
            finalQuota,
            state: "pending",
            confirmedAt: null,
          },
        });
      }
      return this.dto(
        await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId }, include: carpoolOrderInclude }),
      );
    });
  }
  async confirm(orderId: string, userId: string) {
    return this.repository.withTransaction(async (tx) => {
      const member = await tx.carpoolMember.findUnique({
        where: { orderId_userId: { orderId, userId } },
        include: { order: true, reservation: true },
      });
      if (!member) throw new NotFoundError("Carpool member not found");
      this.open(member.order);
      const other = await tx.balanceReservation.aggregate({
        where: { userId, state: "reserved", NOT: { memberId: member.id } },
        _sum: { amount: true },
      });
      const account = await lockBalanceAccount(tx, userId, true);
      if (!account || new Decimal(account.balance).minus(other._sum.amount ?? 0).lessThan(member.payableAmount))
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
      return this.dto(
        await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId }, include: carpoolOrderInclude }),
      );
    });
  }
  async leave(orderId: string, userId: string) {
    return this.repository.withTransaction(async (tx) => {
      const member = await tx.carpoolMember.findUnique({
        where: { orderId_userId: { orderId, userId } },
        include: { order: true, reservation: true },
      });
      if (!member) throw new NotFoundError("Carpool member not found");
      this.open(member.order);
      if (member.role === "owner") throw new BadRequestError("Initiator must cancel the carpool instead");
      if (member.reservation?.state === "reserved")
        await tx.balanceReservation.update({ where: { id: member.reservation.id }, data: { state: "released" } });
      await tx.carpoolMember.delete({ where: { id: member.id } });
      return this.dto(
        await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId }, include: carpoolOrderInclude }),
      );
    });
  }
  async cancel(orderId: string, userId: string) {
    return this.repository.withTransaction(async (tx) => {
      const order = await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId } });
      this.owner(order, userId);
      this.open(order);
      await tx.balanceReservation.updateMany({ where: { orderId, state: "reserved" }, data: { state: "released" } });
      await tx.carpoolOrder.update({ where: { id: orderId }, data: { state: "cancelled" } });
      return this.dto(
        await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId }, include: carpoolOrderInclude }),
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
      this.open(order);
      if (
        !order.members.length ||
        !order.members.every((m) => m.state === "confirmed" && m.reservation?.state === "reserved")
      )
        throw new BadRequestError("All members must confirm and reserve their own share");
      if (
        !order.members.reduce((s, m) => s.plus(m.paymentRatio), ZERO).equals(HUNDRED) ||
        !order.members.reduce((s, m) => s.plus(m.quotaRatio), ZERO).equals(HUNDRED)
      )
        throw new BadRequestError("Payment and quota ratios must each total 100");
      await lockBalanceAccounts(
        tx,
        order.members.map((m) => ({ userId: m.userId, createIfMissing: true })),
      );
      for (const member of order.members) {
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
      return this.dto(
        await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId }, include: carpoolOrderInclude }),
      );
    });
  }
  async accept(orderId: string) {
    const order = await this.repository.findOrderSummary(orderId);
    if (!order) throw new NotFoundError("Carpool order not found");
    if (order.state !== "submitted") throw new BadRequestError("Carpool has not been submitted");
    await this.repository.acceptOrder(orderId);
    return this.getOrder(orderId, "", true);
  }
  async fulfill(orderId: string, relayChannelId: string) {
    return this.repository.withTransaction(async (tx) => {
      const order = await tx.carpoolOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: { members: true, packageTemplate: true },
      });
      if (order.state !== "accepted") throw new BadRequestError("Carpool must be accepted before fulfillment");
      const channel = await tx.relayChannel.findUnique({ where: { id: relayChannelId } });
      if (!channel || channel.status !== 1) throw new NotFoundError("Relay channel not found");
      const template = await tx.monthlyPassTemplate.findUniqueOrThrow({
        where: { id: order.packageTemplate.monthlyPassTemplateId },
      });
      const now = new Date(),
        endAt = new Date(now.getTime() + order.validityDays * 86400000);
      for (const member of order.members) {
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
            name: "Carpool " + order.packageName,
            token: "rlt_" + crypto.randomBytes(24).toString("hex"),
            channelId: relayChannelId,
            quotaLimit: member.finalQuota,
            allowedModels: order.allowedModels,
          },
        });
        await tx.carpoolMember.update({ where: { id: member.id }, data: { userMonthlyPassId: pass.id } });
      }
      await tx.carpoolOrder.update({
        where: { id: orderId },
        data: { state: "fulfilled", relayChannelId, fulfilledAt: new Date() },
      });
      return this.dto(
        await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId }, include: carpoolOrderInclude }),
      );
    });
  }
  async fail(orderId: string, reason?: string) {
    return this.repository.withTransaction(async (tx) => {
      const order = await tx.carpoolOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: { members: { include: { reservation: true } } },
      });
      if (!["submitted", "accepted"].includes(order.state))
        throw new BadRequestError("Carpool cannot be refunded in its current state");
      await lockBalanceAccounts(
        tx,
        order.members.map((m) => ({ userId: m.userId, createIfMissing: true })),
      );
      for (const member of order.members) {
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
        data: { state: "failed", failedAt: new Date(), failureReason: reason ?? null },
      });
      return this.dto(
        await tx.carpoolOrder.findUniqueOrThrow({ where: { id: orderId }, include: carpoolOrderInclude }),
      );
    });
  }
}

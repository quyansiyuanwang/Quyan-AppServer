import crypto from "crypto";
import type { Request } from "express";
import { BadRequestError } from "@/util/errors";
import { ConfigService } from "@/services/system/config.service";
import { UserRepository } from "@/store/users/user.repository";
import type { UserStore } from "@/store/users/user.store";
import { BalanceTransferRepository } from "@/store/billing/balance-transfer.repository";
import type { BalanceTransferStore } from "@/store/billing/balance-transfer.store";
import type {
  BalanceGiftCodeDto,
  BalanceTransferConfigDto,
  BalanceTransferResponse,
  CreateBalanceGiftCodeDto,
  CreateBalanceTransferDto,
} from "@/api/dto/billing/balance-transfer.dto";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";

const round4 = (value: number): number => Math.round((value + Number.EPSILON) * 10000) / 10000;

export class BalanceTransferService {
  private static instance: BalanceTransferService;

  private constructor(
    private readonly repository: BalanceTransferStore = BalanceTransferRepository.getInstance(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly configService: ConfigService = ConfigService.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
  ) {}

  static getInstance(): BalanceTransferService {
    if (!BalanceTransferService.instance) BalanceTransferService.instance = new BalanceTransferService();
    return BalanceTransferService.instance;
  }

  async getConfig(): Promise<BalanceTransferConfigDto> {
    const config = await this.configService.getBillingConfig();
    return {
      giftCodeEnabled: config.giftCodeEnabled,
      directTransferEnabled: config.directTransferEnabled,
      giftCodeFeePercent: config.giftCodeFeePercent,
      directTransferFeePercent: config.directTransferFeePercent,
      giftCodeCancelFeeRefundPercent: config.giftCodeCancelFeeRefundPercent,
    };
  }

  async createGiftCode(
    body: CreateBalanceGiftCodeDto,
    senderId: string,
    request?: Request,
  ): Promise<BalanceGiftCodeDto> {
    if (body.expiresAt && body.expiresAt <= new Date()) throw new BadRequestError("过期时间必须晚于当前时间");
    const config = await this.getConfig();
    if (!config.giftCodeEnabled) throw new BadRequestError("兑换码转出功能暂未启用");

    const feeAmount = round4((body.amount * config.giftCodeFeePercent) / 100);
    const totalDebit = round4(body.amount + feeAmount);
    const code = `ugc_${crypto.randomBytes(24).toString("base64url")}`;
    const { giftCode } = await this.repository.createGiftCode({
      senderId,
      code,
      amount: body.amount,
      feeAmount,
      feePercent: config.giftCodeFeePercent,
      cancelFeeRefundPercent: config.giftCodeCancelFeeRefundPercent,
      totalDebit,
      expiresAt: body.expiresAt,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.BALANCE_GIFT_CODE_CREATE,
      operationCategory: OperationCategory.BILLING,
      actorUserId: senderId,
      targetResourceId: giftCode.id,
      targetResourceType: "BALANCE_GIFT_CODE",
      description: "创建了用户余额兑换码",
      changes: { amount: body.amount, feeAmount, totalDebit, codeSuffix: code.slice(-6) },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
    return this.toGiftCodeDto(giftCode);
  }

  async listGiftCodes(senderId: string, page = 1, pageSize = 20) {
    const normalizedPage = Math.max(1, Math.floor(page));
    const normalizedPageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const { total, records } = await this.repository.listGiftCodes(
      senderId,
      (normalizedPage - 1) * normalizedPageSize,
      normalizedPageSize,
    );
    return {
      total,
      records: records.map((record) => this.toGiftCodeDto(record)),
      page: normalizedPage,
      pageSize: normalizedPageSize,
    };
  }

  async cancelGiftCode(id: string, senderId: string, request?: Request) {
    const result = await this.repository.cancelGiftCode(id, senderId);
    await this.businessLogService.logOperation({
      operationType: OperationType.BALANCE_GIFT_CODE_CANCEL,
      operationCategory: OperationCategory.BILLING,
      actorUserId: senderId,
      targetResourceId: id,
      targetResourceType: "BALANCE_GIFT_CODE",
      description: "取消了用户余额兑换码",
      changes: { refundedAmount: result.refundedAmount },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
    return result;
  }

  async redeemGiftCode(code: string, userId: string, request?: Request): Promise<{ balance: number }> {
    const result = await this.repository.redeemGiftCode(code, userId);
    await this.businessLogService.logOperation({
      operationType: OperationType.BALANCE_GIFT_CODE_REDEEM,
      operationCategory: OperationCategory.BILLING,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceType: "BALANCE_GIFT_CODE",
      description: "兑换了用户余额兑换码",
      changes: { amount: result.amount, codeSuffix: code.slice(-6), balance: result.balance },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
    return { balance: result.balance };
  }

  async createTransfer(
    body: CreateBalanceTransferDto,
    senderId: string,
    request?: Request,
  ): Promise<BalanceTransferResponse> {
    const recipientUsername = body.recipientUsername.trim();
    const recipient = await this.userRepository.findByUsername(recipientUsername);
    if (!recipient) throw new BadRequestError("收款用户不存在或不可用");
    if (recipient.id === senderId) throw new BadRequestError("不能向自己转账");

    const config = await this.getConfig();
    if (!config.directTransferEnabled) throw new BadRequestError("直接转账功能暂未启用");
    const feeAmount = round4((body.amount * config.directTransferFeePercent) / 100);
    const totalDebit = round4(body.amount + feeAmount);
    const { transfer, balance } = await this.repository.createTransfer({
      senderId,
      recipientId: recipient.id,
      amount: body.amount,
      feeAmount,
      feePercent: config.directTransferFeePercent,
      totalDebit,
      description: body.description?.trim() || undefined,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.BALANCE_TRANSFER_CREATE,
      operationCategory: OperationCategory.BILLING,
      actorUserId: senderId,
      targetUserId: recipient.id,
      targetResourceId: transfer.id,
      targetResourceType: "BALANCE_TRANSFER",
      description: "创建了用户余额转账",
      changes: { amount: body.amount, feeAmount, totalDebit, recipientUsername },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
    return {
      id: transfer.id,
      recipientUsername,
      amount: Number(transfer.amount),
      feeAmount: Number(transfer.feeAmount),
      feePercent: Number(transfer.feePercent),
      totalDebit: Number(transfer.totalDebit),
      balance,
      createTime: transfer.createTime,
    };
  }

  private toGiftCodeDto(record: any): BalanceGiftCodeDto {
    return {
      id: record.id,
      code: record.code,
      amount: Number(record.amount),
      feeAmount: Number(record.feeAmount),
      feePercent: Number(record.feePercent),
      cancelFeeRefundPercent: Number(record.cancelFeeRefundPercent),
      totalDebit: Number(record.totalDebit),
      refundedAmount: record.refundedAmount == null ? null : Number(record.refundedAmount),
      state: record.state,
      redeemedByUsername: record.redeemedByUser?.username ?? null,
      redeemedAt: record.redeemedAt,
      cancelledAt: record.cancelledAt,
      expiresAt: record.expiresAt,
      createTime: record.createTime,
    };
  }
}

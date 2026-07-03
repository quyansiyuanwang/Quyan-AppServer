import type { CreateRedemptionCodeDto, RedemptionCodeDto } from "@/api/dto/billing/redemption-code.dto";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { BadRequestError } from "@/util/errors";
import crypto from "crypto";
import { RedemptionCodeRepository } from "@/store/billing/redemption-code.repository";
import type { RedemptionCodeStore } from "@/store/billing/redemption-code.store";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import type { Request } from "express";
import { NotificationService } from "@/services/notification/notification.service";
import { NotificationPreferenceRepository } from "@/store/notification/notification-preference.repository";
import { NotificationEvent } from "@/constant/notification-event";

export class RedemptionCodeService {
  private static instance: RedemptionCodeService;

  private constructor(
    private readonly repository: RedemptionCodeStore = RedemptionCodeRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
  ) {}

  public static getInstance(): RedemptionCodeService {
    if (!RedemptionCodeService.instance) RedemptionCodeService.instance = new RedemptionCodeService();
    return RedemptionCodeService.instance;
  }

  public async createCodes(
    body: CreateRedemptionCodeDto,
    createdBy: string,
    request?: Request,
  ): Promise<RedemptionCodeDto[]> {
    const count = body.count ?? 1;

    this.validateCreateRules(body, count);

    const codes: RedemptionCodeDto[] = [];
    for (let i = 0; i < count; i++) {
      const code = crypto.randomBytes(16).toString("hex");
      const record = await this.repository.create({
        code,
        amount: body.amount,
        createdBy,
        expiresAt: body.expiresAt || null,
      });

      codes.push(this.toDto(record));
    }

    await this.businessLogService.logOperation({
      operationType: OperationType.REDEMPTION_CODE_CREATE,
      operationCategory: OperationCategory.BILLING,
      actorUserId: createdBy,
      targetResourceId: "batch",
      targetResourceType: "REDEMPTION_CODE",
      description: `创建了 ${codes.length} 个兑换码`,
      changes: {
        count: codes.length,
        amount: body.amount,
        expiresAt: body.expiresAt,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return codes;
  }

  public async listCodes(
    page?: number,
    pageSize?: number,
  ): Promise<{ total: number; records: RedemptionCodeDto[]; page: number; pageSize: number }> {
    const currentPage = page && page > 0 ? page : 1;
    const currentPageSize = pageSize && pageSize > 0 ? Math.min(pageSize, 100) : 20;
    const skip = (currentPage - 1) * currentPageSize;

    const [total, records] = await Promise.all([
      this.repository.countAll(),
      this.repository.list(skip, currentPageSize),
    ]);

    return {
      total,
      page: currentPage,
      pageSize: currentPageSize,
      records: records.map((r) => ({
        id: r.id,
        code: r.code,
        amount: Number(r.amount),
        usedBy: r.usedBy,
        usedByUsername: r.usedByUser?.username,
        usedAt: r.usedAt,
        createdBy: r.createdBy,
        createdByUsername: r.createdByUser?.username,
        expiresAt: r.expiresAt,
        createTime: r.createTime,
      })),
    };
  }

  public async redeemCode(code: string, userId: string, request?: Request): Promise<{ balance: number }> {
    try {
      const result = await this.repository.redeem(code, userId);

      await this.businessLogService.logOperation({
        operationType: OperationType.REDEMPTION_CODE_REDEEM,
        operationCategory: OperationCategory.BILLING,
        actorUserId: userId,
        targetUserId: userId,
        targetResourceType: "REDEMPTION_CODE",
        description: "兑换了兑换码",
        changes: {
          codeSuffix: code.slice(-4),
          balance: result.balance,
        },
        success: true,
        ...buildBusinessLogRequestContext(request),
      });

      // Fire-and-forget notification
      this.dispatchRedemptionSuccessNotification(userId, result.amount, result.balance).catch(() => {});

      return { balance: result.balance };
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      if (error.message === "REDEMPTION_CODE_NOT_FOUND") throw new BadRequestError("兑换码不存在");
      if (error.message === "REDEMPTION_CODE_ALREADY_USED") throw new BadRequestError("兑换码已被使用");
      if (error.message === "REDEMPTION_CODE_EXPIRED") throw new BadRequestError("兑换码已过期");

      throw error;
    }
  }

  public async deleteCode(id: string, actorUserId: string, request?: Request): Promise<void> {
    const record = await this.repository.deleteById(id);

    await this.businessLogService.logOperation({
      operationType: OperationType.REDEMPTION_CODE_DELETE,
      operationCategory: OperationCategory.BILLING,
      actorUserId,
      targetResourceId: record.id,
      targetResourceType: "REDEMPTION_CODE",
      description: "删除了兑换码",
      changes: {
        amount: Number(record.amount),
        codeSuffix: record.code.slice(-4),
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  private validateCreateRules(body: CreateRedemptionCodeDto, count: number): void {
    if (body.expiresAt && body.expiresAt <= new Date()) throw new BadRequestError("过期时间必须晚于当前时间");

    // Defense-in-depth: keep service safe even if called outside TSOA validation pipeline.
    if (!Number.isInteger(count) || count < 1 || count > 1000)
      throw new BadRequestError("生成数量必须是 1 到 1000 的整数");
  }

  private toDto(record: {
    id: string;
    code: string;
    amount: any;
    usedBy: string | null;
    usedAt: Date | null;
    createdBy: string;
    expiresAt: Date | null;
    createTime: Date;
  }): RedemptionCodeDto {
    return {
      id: record.id,
      code: record.code,
      amount: Number(record.amount),
      usedBy: record.usedBy,
      usedAt: record.usedAt,
      createdBy: record.createdBy,
      expiresAt: record.expiresAt,
      createTime: record.createTime,
    };
  }

  private async dispatchRedemptionSuccessNotification(
    userId: string,
    amount: number,
    balanceAfter: number,
  ): Promise<void> {
    try {
      const prefRepo = NotificationPreferenceRepository.getInstance();
      const pref = await prefRepo.findByUserId(userId);
      if (!pref) return;

      const subscribedEvents = (pref.subscribedEvents as string[]) ?? [];
      if (!subscribedEvents.includes(NotificationEvent.REDEMPTION_SUCCESS)) return;

      NotificationService.getInstance().dispatch(userId, NotificationEvent.REDEMPTION_SUCCESS, {
        title: "兑换码兑换成功",
        content: `您已成功兑换 ${amount.toFixed(4)} 曲，当前余额为 ${balanceAfter.toFixed(4)} 曲。`,
        data: { amount: amount.toFixed(4), balanceAfter: balanceAfter.toFixed(4) },
      });
    } catch {
      // non-fatal
    }
  }
}

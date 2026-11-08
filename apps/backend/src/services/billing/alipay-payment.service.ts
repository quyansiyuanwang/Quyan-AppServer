import { randomUUID, createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { Decimal } from "@prisma/client/runtime/library";
import type { AlipayProfile, PaymentRefund } from "@prisma/client";
import { ConfigService } from "@/services/system/config.service";
import { CONFIG_KEYS } from "@/constant/config-keys";
import { AlipayRepository, type AlipayOrderRecord } from "@/store/billing/alipay.repository";
import { BadRequestError, ConflictError, NotFoundError } from "@/util/errors";
import { createAlipayClient, encryptAlipayCredentials, decryptAlipayCredentials } from "./alipay-client";
import {
  ALIPAY_POLICY,
  alipaySettingsSchema,
  alipayCredentialsSchema,
  moneySchema,
  requestIdSchema,
  rechargeCredit,
} from "./alipay-policy";
import type {
  AlipayConfigDto,
  AlipayCheckoutDto,
  AlipayOrderDto,
  AlipayOrderListDto,
  AlipayRefundDto,
  CreateAlipayOrderDto,
  CreateAlipayRefundDto,
  PublicAlipayConfigDto,
  SetAlipayConfigDto,
} from "@/api/dto/billing/alipay.dto";
import type { TypedRequest } from "@/types/express";
import { assertPaymentAdmin } from "./alipay-authorization";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import { getLogger, LogCategory } from "@/util/logger";
import { env } from "@/config/env";
import { ApiRoutePath } from "@/build/route-paths";

const logger = getLogger("AlipayPayment", LogCategory.BUSINESS);
const missing = () => new NotFoundError("Payment order not found", undefined, { messageKey: "payment.notFound" });
const invalid = () =>
  new BadRequestError("Invalid payment operation", undefined, { messageKey: "payment.invalidOperation" });
const keys = Object.values(CONFIG_KEYS.ALIPAY);
export class AlipayPaymentService {
  private static instance: AlipayPaymentService;
  private constructor(
    private readonly repository = AlipayRepository.getInstance(),
    private readonly configs = ConfigService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new AlipayPaymentService());
  }

  private async configuration() {
    const values = await this.configs.getMultiple(keys);
    const settings = alipaySettingsSchema.parse(
      values[CONFIG_KEYS.ALIPAY.SETTINGS] ? JSON.parse(values[CONFIG_KEYS.ALIPAY.SETTINGS]) : {},
    );
    const profile = values[CONFIG_KEYS.ALIPAY.ACTIVE_PROFILE]
      ? await this.repository.profile(values[CONFIG_KEYS.ALIPAY.ACTIVE_PROFILE])
      : null;
    return { settings, profile };
  }
  private client(profile: AlipayProfile) {
    return createAlipayClient(decryptAlipayCredentials(profile.encryptedCredentials));
  }
  private notifyUrl(backendPublicUrl: string) {
    try {
      const url = new URL(ApiRoutePath.V1PaymentsAlipayNotify, backendPublicUrl);
      if (url.protocol !== "https:" || url.username || url.password) throw invalid();
      return url.toString();
    } catch {
      throw new BadRequestError("Public HTTPS backend URL required", undefined, {
        messageKey: "payment.callbackUrlRequired",
      });
    }
  }
  async getConfig(request: TypedRequest): Promise<AlipayConfigDto> {
    return this.configs.getManagedConfiguration(keys, request, async () => {
      const { settings, profile } = await this.configuration();
      return {
        settings,
        profile: profile
          ? {
              appId: profile.appId,
              sellerId: profile.sellerId,
              sandbox: profile.sandbox,
              keyType: decryptAlipayCredentials(profile.encryptedCredentials).keyType,
              hasCredentials: true,
            }
          : undefined,
      };
    });
  }
  async saveConfig(body: SetAlipayConfigDto, request: TypedRequest): Promise<AlipayConfigDto> {
    // Authorize before parsing or encrypting a replacement secret.
    await this.getConfig(request);
    const parsed = alipaySettingsSchema.safeParse(body.settings);
    if (!parsed.success) throw invalid();
    const current = await this.configuration();
    let profile = current.profile;
    if (body.credentials) {
      const credentials = alipayCredentialsSchema.safeParse(body.credentials);
      if (!credentials.success) throw invalid();
      try {
        const privateKey = createPrivateKey(credentials.data.privateKey);
        if (privateKey.asymmetricKeyType !== "rsa" || (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)
          throw invalid();
        if (credentials.data.alipayPublicKey) createPublicKey(credentials.data.alipayPublicKey);
        createAlipayClient(credentials.data);
      } catch {
        throw new BadRequestError("Invalid Alipay credentials", undefined, {
          messageKey: "payment.credentialsInvalid",
        });
      }
      profile = await this.repository.createProfile({
        appId: credentials.data.appId,
        sellerId: credentials.data.sellerId,
        sandbox: credentials.data.sandbox,
        encryptedCredentials: encryptAlipayCredentials(credentials.data),
      });
    }
    if (parsed.data.returnUrl) {
      const returnUrl = new URL(parsed.data.returnUrl);
      if (
        returnUrl.username ||
        returnUrl.password ||
        returnUrl.hash ||
        (returnUrl.protocol !== "https:" && !(profile?.sandbox && returnUrl.protocol === "http:"))
      )
        throw invalid();
    } else if (parsed.data.enabled) throw invalid();
    if (parsed.data.enabled && !profile) throw invalid();
    if (parsed.data.enabled && profile?.sandbox && env.runtime.isProduction) throw invalid();
    const { backendPublicUrl } = await this.configs.getSiteConfig();
    if (parsed.data.enabled) this.notifyUrl(backendPublicUrl);
    await this.configs.setManagedConfiguration(
      {
        [CONFIG_KEYS.ALIPAY.SETTINGS]: JSON.stringify(parsed.data),
        [CONFIG_KEYS.ALIPAY.ACTIVE_PROFILE]: profile?.id ?? "",
      },
      request.user!.userId,
      request,
    );
    await this.audit(OperationType.PAYMENT_CONFIG_UPDATE, profile?.id ?? "", request.user!.userId, request);
    return this.getConfig(request);
  }
  async publicConfig(): Promise<PublicAlipayConfigDto> {
    const { settings, profile } = await this.configuration();
    return {
      enabled: settings.enabled && Boolean(profile) && !(profile?.sandbox && env.runtime.isProduction),
      sandbox: profile?.sandbox ?? true,
      minAmount: settings.minAmount,
      maxAmount: settings.maxAmount,
      rechargeRatio: String(await this.configs.getRechargeRatio()),
    };
  }
  private dto(order: AlipayOrderRecord): AlipayOrderDto {
    return {
      id: order.id,
      userId: order.userId,
      outTradeNo: order.outTradeNo,
      tradeNo: order.tradeNo,
      amount: order.amount.toFixed(2),
      creditAmount: order.creditAmount.toFixed(4),
      rechargeRatio: order.rechargeRatio.toFixed(4),
      refundedAmount: order.refundedAmount.toFixed(2),
      state: order.state,
      sandbox: order.profile.sandbox,
      createTime: order.createTime,
      expiresAt: order.expiresAt,
      paidAt: order.paidAt,
      refunds: order.refunds.map((v) => this.refundDto(v)),
    };
  }
  private refundDto(refund: PaymentRefund): AlipayRefundDto {
    return {
      id: refund.id,
      outRequestNo: refund.outRequestNo,
      amount: refund.amount.toFixed(2),
      creditAmount: refund.creditAmount.toFixed(4),
      state: refund.state,
      failureCode: refund.failureCode,
      createTime: refund.createTime,
      completedAt: refund.completedAt,
    };
  }
  private async owned(id: string, userId: string) {
    const order = await this.repository.get(id);
    if (!order || order.userId !== userId || order.status !== 1) throw missing();
    return order;
  }
  async create(body: CreateAlipayOrderDto, request: TypedRequest): Promise<AlipayCheckoutDto> {
    if (!moneySchema.safeParse(body.amount).success || !requestIdSchema.safeParse(body.requestId).success)
      throw invalid();
    const userId = request.user!.userId;
    let order = await this.repository.byRequest(userId, body.requestId);
    if (order && !order.amount.equals(body.amount))
      throw new ConflictError("Request amount differs", undefined, { messageKey: "payment.requestConflict" });
    if (!order) {
      const { settings, profile } = await this.configuration();
      if (!settings.enabled || !profile)
        throw new BadRequestError("Alipay disabled", undefined, { messageKey: "payment.disabled" });
      if (!settings.returnUrl || (profile.sandbox && env.runtime.isProduction)) throw invalid();
      const returnUrl = new URL(settings.returnUrl);
      if (!profile.sandbox && returnUrl.protocol !== "https:") throw invalid();
      const amount = new Decimal(body.amount);
      if (amount.lt(settings.minAmount) || amount.gt(settings.maxAmount)) throw invalid();
      const ratio = new Decimal(await this.configs.getRechargeRatio()).toDecimalPlaces(4, Decimal.ROUND_DOWN);
      const credit = rechargeCredit(amount, ratio);
      if (credit.lte(0) || credit.gt(ALIPAY_POLICY.maxBalance)) throw invalid();
      const { backendPublicUrl } = await this.configs.getSiteConfig();
      const notifyUrl = this.notifyUrl(backendPublicUrl);
      order = await this.repository.create({
        userId,
        requestId: body.requestId,
        profileId: profile.id,
        outTradeNo: "AP" + randomUUID().replaceAll("-", ""),
        amount,
        rechargeRatio: ratio,
        creditAmount: credit,
        expiresAt: new Date(Date.now() + settings.orderTimeoutMinutes * 60000),
        notifyUrl,
        returnUrl: settings.returnUrl,
      });
      await this.audit(OperationType.PAYMENT_CREATE, order.id, userId, request);
    }
    let paymentUrl = "";
    if (!order.paidAt && order.state === "pending" && order.expiresAt > new Date()) {
      if (order.profile.sandbox && env.runtime.isProduction) throw invalid();
      const returnUrl = new URL(order.returnUrl);
      returnUrl.searchParams.set("paymentOrder", order.id);
      paymentUrl = this.client(order.profile).pageExecute("alipay.trade.page.pay", "GET", {
        notifyUrl: order.notifyUrl,
        returnUrl: returnUrl.toString(),
        bizContent: {
          out_trade_no: order.outTradeNo,
          total_amount: order.amount.toFixed(2),
          subject: "Quyan account recharge",
          product_code: "FAST_INSTANT_TRADE_PAY",
          time_expire: this.alipayTime(order.expiresAt),
        },
      });
    }
    return { order: this.dto(order), paymentUrl };
  }
  private alipayTime(date: Date) {
    return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ");
  }
  async get(id: string, userId: string) {
    return this.dto(await this.owned(id, userId));
  }
  async list(page: number, pageSize: number, userId?: string): Promise<AlipayOrderListDto> {
    const result = await this.repository.list(page, pageSize, userId);
    return { ...result, records: result.records.map((v) => this.dto(v)) };
  }
  async listRefunds(id: string, page: number, pageSize: number, userId?: string) {
    if (userId) await this.owned(id, userId);
    const result = await this.repository.listRefunds(id, page, pageSize);
    return { ...result, records: result.records.map((v) => this.refundDto(v)) };
  }
  async refresh(id: string, userId: string) {
    const order = await this.owned(id, userId);
    if (!order.paidAt && order.state === "pending" && order.nextQueryAt <= new Date()) await this.queryOrder(order);
    return this.get(id, userId);
  }
  private verifyTrade(order: AlipayOrderRecord, data: Record<string, unknown>, notify: boolean) {
    if (
      data.out_trade_no !== order.outTradeNo ||
      (notify && data.app_id !== order.profile.appId) ||
      (notify && data.seller_id !== order.profile.sellerId) ||
      (data.seller_id !== undefined && data.seller_id !== order.profile.sellerId) ||
      typeof data.total_amount !== "string" ||
      !new Decimal(data.total_amount).equals(order.amount) ||
      typeof data.trade_no !== "string" ||
      !/^[A-Za-z0-9]{1,64}$/.test(data.trade_no)
    )
      throw invalid();
  }
  private async applyTrade(order: AlipayOrderRecord, data: Record<string, unknown>) {
    // Sandbox credit must never enter a production balance account, including historical orders.
    if (order.profile.sandbox && env.runtime.isProduction) throw invalid();
    this.verifyTrade(order, data, false);
    if (data.trade_status === "TRADE_SUCCESS" || data.trade_status === "TRADE_FINISHED") {
      if (await this.repository.credit(order.id, String(data.trade_no), String(data.trade_status)))
        await this.audit(OperationType.PAYMENT_CREDIT, order.id, order.userId);
    } else if (data.trade_status === "TRADE_CLOSED" && !order.paidAt) await this.repository.close(order.id);
  }
  async notify(body: unknown): Promise<boolean> {
    try {
      if (!body || typeof body !== "object" || Array.isArray(body)) return false;
      const data = body as Record<string, string>;
      if (Object.values(data).some((v) => typeof v !== "string") || data.sign_type !== "RSA2") return false;
      const order = typeof data.out_trade_no === "string" ? await this.repository.byTradeNo(data.out_trade_no) : null;
      if (!order || !this.client(order.profile).checkNotifySignV2(data)) return false;
      this.verifyTrade(order, data, true);
      if (data.gmt_refund || data.out_biz_no) {
        const refund = data.out_biz_no ? await this.repository.refundByRequest(data.out_biz_no) : null;
        if (refund && refund.orderId === order.id) await this.queryRefund(refund.id);
      } else await this.applyTrade(order, data);
      return true;
    } catch {
      logger.warn("Payment notification rejected or deferred", { reason: "verification-or-settlement-failed" });
      return false;
    }
  }
  private async queryOrder(order: AlipayOrderRecord) {
    await this.repository.deferOrder(order.id);
    try {
      const client = this.client(order.profile);
      const result = await client.exec(
        "alipay.trade.query",
        { bizContent: { out_trade_no: order.outTradeNo } },
        { validateSign: true },
      );
      if (result.code === "10000") {
        await this.applyTrade(order, result);
        if (result.trade_status === "WAIT_BUYER_PAY" && order.expiresAt <= new Date()) {
          const close = await client.exec(
            "alipay.trade.close",
            { bizContent: { out_trade_no: order.outTradeNo } },
            { validateSign: true },
          );
          if (close.code === "10000") await this.repository.close(order.id);
        }
      } else if (result.sub_code === "ACQ.TRADE_NOT_EXIST" && order.expiresAt <= new Date())
        await this.repository.close(order.id);
    } catch {
      logger.warn("Payment query deferred", { orderId: order.id });
    }
  }
  async refund(id: string, body: CreateAlipayRefundDto, request: TypedRequest): Promise<AlipayRefundDto> {
    await assertPaymentAdmin(request, "RefundOrder");
    if (
      !moneySchema.safeParse(body.amount).success ||
      !requestIdSchema.safeParse(body.requestId).success ||
      typeof body.reason !== "string" ||
      !body.reason.trim() ||
      body.reason.length > 200
    )
      throw invalid();
    const { settings } = await this.configuration();
    if (!settings.refundEnabled)
      throw new BadRequestError("Refunds disabled", undefined, { messageKey: "payment.disabled" });
    const outRequestNo = "RF" + createHash("sha256").update(body.requestId).digest("hex").slice(0, 48);
    const { refund, created } = await this.repository.reserveRefund(
      id,
      outRequestNo,
      new Decimal(body.amount),
      body.reason.trim(),
      request.user!.userId,
      () => assertPaymentAdmin(request, "RefundOrder"),
    );
    if (created) {
      await this.audit(OperationType.PAYMENT_REFUND, refund.id, request.user!.userId, request);
      await this.submitRefund(refund.id);
    }
    return this.refundDto((await this.repository.refund(refund.id))!);
  }
  private async submitRefund(id: string) {
    const refund = await this.repository.refund(id);
    if (!refund || refund.state !== "processing") return;
    await this.repository.deferRefund(id);
    try {
      const result = await this.client(refund.order.profile).exec(
        "alipay.trade.refund",
        {
          bizContent: {
            out_trade_no: refund.order.outTradeNo,
            out_request_no: refund.outRequestNo,
            refund_amount: refund.amount.toFixed(2),
            refund_reason: refund.reason,
          },
        },
        { validateSign: true },
      );
      if (result.code === "10000" && result.fund_change === "Y") {
        if (
          result.out_trade_no !== refund.order.outTradeNo ||
          result.trade_no !== refund.order.tradeNo ||
          // The refund response reports the transaction's cumulative refunded amount.
          !new Decimal(String(result.refund_fee)).equals(refund.order.refundedAmount.plus(refund.amount))
        )
          throw invalid();
        await this.repository.finishRefund(id, true);
      } else if (
        result.code === "40004" &&
        [
          "ACQ.TRADE_NOT_EXIST",
          "ACQ.TRADE_STATUS_ERROR",
          "ACQ.REFUND_AMT_NOT_EQUAL_TOTAL",
          "ACQ.REFUND_FEE_ERROR",
          "ACQ.TRADE_HAS_FINISHED",
          "ACQ.TRADE_NOT_ALLOW_REFUND",
          "ACQ.NOT_ALLOW_PARTIAL_REFUND",
          "ACQ.SELLER_BALANCE_NOT_ENOUGH",
        ].includes(String(result.sub_code))
      ) {
        await this.repository.finishRefund(id, false, "PROVIDER_REJECTED");
      }
    } catch {
      logger.warn("Refund result unknown; retained for recovery", { refundId: id });
    }
  }
  async queryRefund(id: string): Promise<AlipayRefundDto> {
    const refund = await this.repository.refund(id);
    if (!refund) throw missing();
    if (refund.state !== "processing") return this.refundDto(refund);
    await this.repository.deferRefund(id);
    try {
      const result = await this.client(refund.order.profile).exec(
        "alipay.trade.fastpay.refund.query",
        {
          bizContent: { out_trade_no: refund.order.outTradeNo, out_request_no: refund.outRequestNo },
        },
        { validateSign: true },
      );
      if (
        result.code === "10000" &&
        result.refund_status === "REFUND_SUCCESS" &&
        result.out_request_no === refund.outRequestNo &&
        result.out_trade_no === refund.order.outTradeNo &&
        result.trade_no === refund.order.tradeNo &&
        new Decimal(String(result.refund_amount)).equals(refund.amount)
      ) {
        await this.repository.finishRefund(id, true);
      } else if ((result.code === "10000" && !result.refund_status) || result.sub_code === "ACQ.TRADE_NOT_EXIST") {
        // A crash may precede the first request. Retry the SAME provider idempotency key, never release an unknown refund.
        await this.submitRefund(id);
      }
    } catch {
      logger.warn("Refund query deferred", { refundId: id });
    }
    return this.refundDto((await this.repository.refund(id))!);
  }
  async recover() {
    for (const order of await this.repository.dueOrders()) await this.queryOrder(order);
    for (const refund of await this.repository.dueRefunds()) {
      await this.queryRefund(refund.id);
      if (refund.queryAttempts >= ALIPAY_POLICY.operatorAlertAfterAttempts)
        logger.error("Refund recovery needs operator attention", { refundId: refund.id });
    }
  }
  private async audit(
    operationType: OperationType,
    targetResourceId: string,
    actorUserId: string,
    request?: TypedRequest,
  ) {
    await BusinessLogService.getInstance().logOperation({
      operationType,
      operationCategory: OperationCategory.BILLING,
      actorUserId,
      targetResourceId,
      targetResourceType: "PAYMENT",
      description: operationType,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }
}

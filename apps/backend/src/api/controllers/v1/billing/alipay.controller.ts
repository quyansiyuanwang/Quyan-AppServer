import {
  Body,
  Controller,
  Get,
  Middlewares,
  Path,
  Post,
  Put,
  Query,
  Request,
  Route,
  Security,
  Tags,
} from "@tsoa/runtime";
import type { Request as ExpressRequest } from "express";
import type { TypedRequest } from "@/types/express";
import { AlipayPaymentService } from "@/services/billing/alipay-payment.service";
import { assertPaymentAdmin, paymentManagementResource } from "@/services/billing/alipay-authorization";
import type {
  AlipayCheckoutDto,
  AlipayConfigDto,
  AlipayOrderDto,
  AlipayOrderListDto,
  AlipayRefundDto,
  CreateAlipayOrderDto,
  CreateAlipayRefundDto,
  PublicAlipayConfigDto,
  SetAlipayConfigDto,
} from "@/api/dto/billing/alipay.dto";
import { iamAuthenticatedAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import { iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";
import { CheckPermission, PermissionCheckMode } from "@/util/permission/permission-decorator";
import { Permission } from "@quyan/shared";
import { alipayConfigurationResources } from "@/iam/request/platform-configuration-resource-resolvers";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { BadRequestError } from "@/util/errors";

function pagination(page: number, pageSize: number) {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100)
    throw new BadRequestError("Invalid pagination", undefined, { messageKey: "errors.badRequest" });
}

@Route("v1/payments/alipay")
@Tags("AlipayPayment")
export class AlipayPaymentController extends Controller {
  private readonly service = AlipayPaymentService.getInstance();

  @Get("public-config")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:payment:GetConfig",
      resourceKind: "single-resource",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  public async getPublicConfig(): Promise<PublicAlipayConfigDto> {
    return this.service.publicConfig();
  }

  @Get("config")
  @Security("jwt")
  @CheckPermission(Permission.SYSTEM_CONFIG, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:system:ListConfigurations",
    resourceKind: "batch",
    resource: alipayConfigurationResources,
  })
  public async getConfig(@Request() request: TypedRequest): Promise<AlipayConfigDto> {
    return this.service.getConfig(request);
  }

  @Put("config")
  @Security("jwt")
  @CheckPermission(Permission.SYSTEM_CONFIG, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:system:UpdateConfigurations",
    resourceKind: "batch",
    resource: alipayConfigurationResources,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }), replayProtectionMiddleware)
  public async setConfig(@Body() body: SetAlipayConfigDto, @Request() request: TypedRequest): Promise<AlipayConfigDto> {
    return this.service.saveConfig(body, request);
  }

  @Post("orders")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:payment:CreateOrder",
      resourceKind: "single-resource",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  @Middlewares(replayProtectionMiddleware)
  public async createOrder(
    @Body() body: CreateAlipayOrderDto,
    @Request() request: TypedRequest,
  ): Promise<AlipayCheckoutDto> {
    return this.service.create(body, request);
  }

  @Get("orders")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:payment:ListOrders",
      resourceKind: "single-resource",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  public async listOrders(
    @Request() request: TypedRequest,
    @Query() page = 1,
    @Query() pageSize = 20,
  ): Promise<AlipayOrderListDto> {
    pagination(page, pageSize);
    return this.service.list(page, pageSize, request.user!.userId);
  }

  @Get("orders/{id}")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:payment:GetOrder",
      resourceKind: "single-resource",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  public async getOrder(@Path() id: string, @Request() request: TypedRequest): Promise<AlipayOrderDto> {
    return this.service.get(id, request.user!.userId);
  }

  @Post("orders/{id}/refresh")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:payment:RefreshOrder",
      resourceKind: "single-resource",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  @Middlewares(replayProtectionMiddleware)
  public async refreshOrder(@Path() id: string, @Request() request: TypedRequest): Promise<AlipayOrderDto> {
    return this.service.refresh(id, request.user!.userId);
  }

  @Get("orders/{id}/refunds")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:payment:ListRefunds",
      resourceKind: "single-resource",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  public async listRefunds(
    @Path() id: string,
    @Request() request: TypedRequest,
    @Query() page = 1,
    @Query() pageSize = 20,
  ): Promise<{ records: AlipayRefundDto[]; total: number; page: number; pageSize: number }> {
    pagination(page, pageSize);
    return this.service.listRefunds(id, page, pageSize, request.user!.userId);
  }

  @Get("management/orders")
  @Security("jwt")
  @CheckPermission(Permission.PAYMENT_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:payment:ListManagedOrders",
    resourceKind: "single-resource",
    resource: paymentManagementResource,
  })
  public async listManagedOrders(
    @Request() request: TypedRequest,
    @Query() page = 1,
    @Query() pageSize = 20,
    @Query() userId?: string,
  ): Promise<AlipayOrderListDto> {
    pagination(page, pageSize);
    await assertPaymentAdmin(request, "ListManagedOrders");
    return this.service.list(page, pageSize, userId);
  }

  @Get("management/orders/{id}/refunds")
  @Security("jwt")
  @CheckPermission(Permission.PAYMENT_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:payment:ListManagedRefunds",
    resourceKind: "single-resource",
    resource: paymentManagementResource,
  })
  public async listManagedRefunds(
    @Path() id: string,
    @Request() request: TypedRequest,
    @Query() page = 1,
    @Query() pageSize = 20,
  ): Promise<{ records: AlipayRefundDto[]; total: number; page: number; pageSize: number }> {
    pagination(page, pageSize);
    await assertPaymentAdmin(request, "ListManagedRefunds");
    return this.service.listRefunds(id, page, pageSize);
  }

  @Post("management/orders/{id}/refunds")
  @Security("jwt")
  @CheckPermission(Permission.PAYMENT_REFUND, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:payment:RefundOrder",
    resourceKind: "single-resource",
    resource: paymentManagementResource,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }), replayProtectionMiddleware)
  public async refundOrder(
    @Path() id: string,
    @Body() body: CreateAlipayRefundDto,
    @Request() request: TypedRequest,
  ): Promise<AlipayRefundDto> {
    return this.service.refund(id, body, request);
  }

  @Post("management/refunds/{id}/refresh")
  @Security("jwt")
  @CheckPermission(Permission.PAYMENT_REFUND, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:payment:RefreshRefund",
    resourceKind: "single-resource",
    resource: paymentManagementResource,
  })
  @Middlewares(replayProtectionMiddleware)
  public async refreshRefund(@Path() id: string, @Request() request: TypedRequest): Promise<AlipayRefundDto> {
    await assertPaymentAdmin(request, "RefreshRefund");
    return this.service.queryRefund(id);
  }

  @Post("notify")
  public async notify(@Request() request: ExpressRequest): Promise<void> {
    const res = request.res!;
    res.locals.skipResponseWrapper = true;
    const success = await this.service.notify(request.body);
    res
      .status(200)
      .type("text/plain")
      .send(success ? "success" : "failure");
  }
}

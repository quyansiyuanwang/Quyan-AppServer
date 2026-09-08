import { Body, Controller, Get, Middlewares, Path, Post, Query, Request, Route, Security, Tags } from "@tsoa/runtime";
import type {
  AcceptCarpoolInviteRequest,
  AllocateCarpoolRatiosRequest,
  CarpoolOrderDto,
  CarpoolPackageTemplateDto,
  CreateCarpoolInviteRequest,
  CreateCarpoolOrderRequest,
  CreateCarpoolPackageTemplateRequest,
  FulfillCarpoolOrderRequest,
} from "@/api/dto/billing/carpool.dto";
import { CarpoolService } from "@/services/billing/carpool.service";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import { validateBody, validateParams } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import {
  acceptCarpoolInviteBodySchema,
  allocateCarpoolRatiosBodySchema,
  carpoolIdParamsSchema,
  createCarpoolInviteBodySchema,
  createCarpoolOrderBodySchema,
  createCarpoolPackageTemplateBodySchema,
  fulfillCarpoolOrderBodySchema,
} from "@/api/schema/billing/carpool.schema";
import type { TypedRequest } from "@/types/express";

@Route("v1/carpools")
@Tags("Carpool")
export class CarpoolController extends Controller {
  private readonly service = CarpoolService.getInstance();
  @Get("packages/published") @Security("jwt") public listPublishedPackages(): Promise<CarpoolPackageTemplateDto[]> {
    return this.service.listPublishedTemplates();
  }
  @Get("packages") @Security("jwt") @RequirePermission(Permission.CARPOOL_TEMPLATE_READ) public listPackages(
    @Query() page?: number,
    @Query() pageSize?: number,
  ) {
    return this.service.listTemplates(page, pageSize);
  }
  @Post("packages")
  @Security("jwt")
  @RequirePermission(Permission.CARPOOL_TEMPLATE_WRITE)
  @Middlewares(replayProtectionMiddleware, validateBody(createCarpoolPackageTemplateBodySchema))
  public createPackage(@Body() body: CreateCarpoolPackageTemplateRequest) {
    return this.service.createTemplate(body);
  }
  @Post("packages/{id}/publish")
  @Security("jwt")
  @RequirePermission(Permission.CARPOOL_TEMPLATE_WRITE)
  @Middlewares(replayProtectionMiddleware, validateParams(carpoolIdParamsSchema))
  public publishPackage(@Path() id: string) {
    return this.service.publishTemplate(id, true);
  }
  @Post("packages/{id}/unpublish")
  @Security("jwt")
  @RequirePermission(Permission.CARPOOL_TEMPLATE_WRITE)
  @Middlewares(replayProtectionMiddleware, validateParams(carpoolIdParamsSchema))
  public unpublishPackage(@Path() id: string) {
    return this.service.publishTemplate(id, false);
  }
  @Get("me") @Security("jwt") public listMine(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
  ) {
    return this.service.listMine(request.user!.userId, page, pageSize);
  }
  @Get("admin") @Security("jwt") @RequirePermission(Permission.CARPOOL_ORDER_READ) public listAdmin(
    @Query() state?: string,
    @Query() page?: number,
    @Query() pageSize?: number,
  ) {
    return this.service.listAdmin(state, page, pageSize);
  }
  @Post()
  @Security("jwt")
  @Middlewares(replayProtectionMiddleware, validateBody(createCarpoolOrderBodySchema))
  public createOrder(
    @Body() body: CreateCarpoolOrderRequest,
    @Request() request: TypedRequest,
  ): Promise<CarpoolOrderDto> {
    return this.service.createOrder(body, request.user!.userId);
  }
  @Get("{id}") @Security("jwt") @Middlewares(validateParams(carpoolIdParamsSchema)) public getOrder(
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<CarpoolOrderDto> {
    return this.service.getOrder(id, request.user!.userId);
  }
  @Post("{id}/invites")
  @Security("jwt")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(carpoolIdParamsSchema),
    validateBody(createCarpoolInviteBodySchema),
  )
  public createInvite(@Path() id: string, @Body() body: CreateCarpoolInviteRequest, @Request() request: TypedRequest) {
    return this.service.invite(id, request.user!.userId, body.validityHours);
  }
  @Post("invites/accept")
  @Security("jwt")
  @Middlewares(replayProtectionMiddleware, validateBody(acceptCarpoolInviteBodySchema))
  public acceptInvite(
    @Body() body: AcceptCarpoolInviteRequest,
    @Request() request: TypedRequest,
  ): Promise<CarpoolOrderDto> {
    return this.service.acceptInvite(body.token, request.user!.userId);
  }
  @Post("{id}/ratios")
  @Security("jwt")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(carpoolIdParamsSchema),
    validateBody(allocateCarpoolRatiosBodySchema),
  )
  public allocateRatios(
    @Path() id: string,
    @Body() body: AllocateCarpoolRatiosRequest,
    @Request() request: TypedRequest,
  ): Promise<CarpoolOrderDto> {
    return this.service.allocate(id, body, request.user!.userId);
  }
  @Post("{id}/confirm")
  @Security("jwt")
  @Middlewares(replayProtectionMiddleware, validateParams(carpoolIdParamsSchema))
  public confirm(@Path() id: string, @Request() request: TypedRequest): Promise<CarpoolOrderDto> {
    return this.service.confirm(id, request.user!.userId);
  }
  @Post("{id}/leave")
  @Security("jwt")
  @Middlewares(replayProtectionMiddleware, validateParams(carpoolIdParamsSchema))
  public leave(@Path() id: string, @Request() request: TypedRequest): Promise<CarpoolOrderDto> {
    return this.service.leave(id, request.user!.userId);
  }
  @Post("{id}/cancel")
  @Security("jwt")
  @Middlewares(replayProtectionMiddleware, validateParams(carpoolIdParamsSchema))
  public cancel(@Path() id: string, @Request() request: TypedRequest): Promise<CarpoolOrderDto> {
    return this.service.cancel(id, request.user!.userId);
  }
  @Post("{id}/submit")
  @Security("jwt")
  @Middlewares(replayProtectionMiddleware, validateParams(carpoolIdParamsSchema))
  public submit(@Path() id: string, @Request() request: TypedRequest): Promise<CarpoolOrderDto> {
    return this.service.submit(id, request.user!.userId);
  }
  @Post("admin/{id}/accept")
  @Security("jwt")
  @RequirePermission(Permission.CARPOOL_ORDER_FULFILL)
  @Middlewares(replayProtectionMiddleware, validateParams(carpoolIdParamsSchema))
  public accept(@Path() id: string): Promise<CarpoolOrderDto> {
    return this.service.accept(id);
  }
  @Post("admin/{id}/fulfill")
  @Security("jwt")
  @RequirePermission(Permission.CARPOOL_ORDER_FULFILL)
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(carpoolIdParamsSchema),
    validateBody(fulfillCarpoolOrderBodySchema),
  )
  public fulfill(@Path() id: string, @Body() body: FulfillCarpoolOrderRequest): Promise<CarpoolOrderDto> {
    return this.service.fulfill(id, body.relayChannelId);
  }
  @Post("admin/{id}/fail")
  @Security("jwt")
  @RequirePermission(Permission.CARPOOL_ORDER_FULFILL)
  @Middlewares(replayProtectionMiddleware, validateParams(carpoolIdParamsSchema))
  public fail(@Path() id: string, @Query() reason?: string): Promise<CarpoolOrderDto> {
    return this.service.fail(id, reason);
  }
}

import { Body, Controller, Delete, Get, Middlewares, Path, Post, Request, Route, Security, Tags } from "@tsoa/runtime";
import type { TypedRequest } from "@/types/express";
import { DeveloperProductPlatformService } from "@/services/developer/developer-product-platform.service";
import { DeveloperProjectService } from "@/services/developer/developer-project.service";
import { Permission } from "@/constant/permission";
import type {
  DeveloperKvValueDto,
  DeveloperPushDeliveryDto,
  SendDeveloperPushDto,
  SendDeveloperVerificationDto,
  SetKvValueDto,
  VerifyDeveloperCodeDto,
} from "@/api/dto/developer/developer.dto";
import {
  kvKeyParamsSchema,
  sendPushBodySchema,
  sendVerificationBodySchema,
  setKvValueBodySchema,
  verifyCodeBodySchema,
} from "@/api/schema/developer/developer.schema";
import { validateBody, validateParams } from "@/middleware/validation";
import { extractClientIp } from "@/util/ip-extractor";

@Route("v1/products/kv")
@Tags("KV Product API")
export class DeveloperProductKvApiController extends Controller {
  private readonly products = DeveloperProductPlatformService.getInstance();
  private readonly project = DeveloperProjectService.getInstance();

  @Get("entries")
  @Security("product-key", [Permission.PRODUCT_KV_READ])
  public async list(@Request() request: TypedRequest) {
    return this.products.executeMetered(request.productApiKey!, Permission.PRODUCT_KV_READ, () =>
      this.project.listKv(request.productApiKey!.backingProjectId),
    );
  }

  @Get("entries/{key}")
  @Security("product-key", [Permission.PRODUCT_KV_READ])
  @Middlewares(validateParams(kvKeyParamsSchema))
  public async get(@Path() key: string, @Request() request: TypedRequest): Promise<DeveloperKvValueDto> {
    return this.products.executeMetered(request.productApiKey!, Permission.PRODUCT_KV_READ, () =>
      this.project.getKv(request.productApiKey!.backingProjectId, key),
    );
  }

  @Post("entries/{key}")
  @Security("product-key", [Permission.PRODUCT_KV_WRITE])
  @Middlewares(validateParams(kvKeyParamsSchema), validateBody(setKvValueBodySchema))
  public async set(
    @Path() key: string,
    @Body() body: SetKvValueDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperKvValueDto> {
    return this.products.executeMetered(request.productApiKey!, Permission.PRODUCT_KV_WRITE, () =>
      this.project.setKv(request.productApiKey!.backingProjectId, key, body),
    );
  }

  @Delete("entries/{key}")
  @Security("product-key", [Permission.PRODUCT_KV_WRITE])
  @Middlewares(validateParams(kvKeyParamsSchema))
  public async delete(@Path() key: string, @Request() request: TypedRequest): Promise<{ success: true }> {
    return this.products.executeMetered(request.productApiKey!, Permission.PRODUCT_KV_WRITE, async () => {
      await this.project.deleteKv(request.productApiKey!.backingProjectId, key);
      return { success: true };
    });
  }
}

@Route("v1/products/verification")
@Tags("Verification Product API")
export class DeveloperProductVerificationApiController extends Controller {
  private readonly products = DeveloperProductPlatformService.getInstance();
  private readonly project = DeveloperProjectService.getInstance();

  @Post("send")
  @Security("product-key", [Permission.PRODUCT_VERIFICATION_SEND])
  @Middlewares(validateBody(sendVerificationBodySchema))
  public async send(
    @Body() body: SendDeveloperVerificationDto,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    await this.products.executeMetered(request.productApiKey!, Permission.PRODUCT_VERIFICATION_SEND, () =>
      this.project.sendVerification(request.productApiKey!.backingProjectId, body, extractClientIp(request), { skipQuota: true }),
    );
    return { success: true };
  }

  @Post("verify")
  @Security("product-key", [Permission.PRODUCT_VERIFICATION_VERIFY])
  @Middlewares(validateBody(verifyCodeBodySchema))
  public async verify(
    @Body() body: VerifyDeveloperCodeDto,
    @Request() request: TypedRequest,
  ): Promise<{ valid: boolean }> {
    return { valid: await this.project.verifyCode(request.productApiKey!.backingProjectId, body) };
  }
}

@Route("v1/products/ip-geolocation")
@Tags("IP Geolocation Product API")
export class DeveloperProductIpApiController extends Controller {
  private readonly products = DeveloperProductPlatformService.getInstance();
  private readonly project = DeveloperProjectService.getInstance();

  @Get("{ip}")
  @Security("product-key", [Permission.PRODUCT_IP_GEOLOCATION_LOOKUP])
  public async lookup(@Path() ip: string, @Request() request: TypedRequest) {
    return this.products.executeMetered(request.productApiKey!, Permission.PRODUCT_IP_GEOLOCATION_LOOKUP, () =>
      this.project.lookupIp(request.productApiKey!.backingProjectId, ip, { skipQuota: true }),
    );
  }
}

@Route("v1/products/push")
@Tags("Push Product API")
export class DeveloperProductPushApiController extends Controller {
  private readonly products = DeveloperProductPlatformService.getInstance();
  private readonly project = DeveloperProjectService.getInstance();

  @Post("send")
  @Security("product-key", [Permission.PRODUCT_PUSH_SEND])
  @Middlewares(validateBody(sendPushBodySchema))
  public async send(
    @Body() body: SendDeveloperPushDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperPushDeliveryDto[]> {
    return this.products.executeMetered(request.productApiKey!, Permission.PRODUCT_PUSH_SEND, () =>
      this.project.sendPush(request.productApiKey!.backingProjectId, body, { skipQuota: true }),
    );
  }
}

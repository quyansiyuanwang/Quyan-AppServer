import { Body, Controller, Delete, Get, Middlewares, Path, Post, Request, Route, Security, Tags } from "@tsoa/runtime";
import type { TypedRequest } from "@/types/express";
import { DeveloperProjectService } from "@/services/developer/developer-project.service";
import type {
  DeveloperKvValueDto,
  DeveloperPushDeliveryDto,
  SendDeveloperPushDto,
  SendDeveloperVerificationDto,
  SetKvValueDto,
  VerifyDeveloperCodeDto,
} from "@/api/dto/developer/developer.dto";
import { validateBody, validateParams } from "@/middleware/validation";
import {
  kvKeyParamsSchema,
  sendPushBodySchema,
  sendVerificationBodySchema,
  setKvValueBodySchema,
  verifyCodeBodySchema,
} from "@/api/schema/developer/developer.schema";

@Route("v1/kv")
@Tags("Developer KV")
export class DeveloperKvApiController extends Controller {
  private readonly service = DeveloperProjectService.getInstance();
  @Get()
  @Security("project-key", ["kv:read"])
  public async list(@Request() request: TypedRequest) {
    return this.service.listKv(request.projectApiKey!.projectId);
  }
  @Get("{key}")
  @Security("project-key", ["kv:read"])
  @Middlewares(validateParams(kvKeyParamsSchema))
  public async get(@Path() key: string, @Request() request: TypedRequest): Promise<DeveloperKvValueDto> {
    return this.service.getKv(request.projectApiKey!.projectId, key);
  }
  @Post("{key}")
  @Security("project-key", ["kv:write"])
  @Middlewares(validateParams(kvKeyParamsSchema), validateBody(setKvValueBodySchema))
  public async set(
    @Path() key: string,
    @Body() body: SetKvValueDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperKvValueDto> {
    return this.service.setKv(request.projectApiKey!.projectId, key, body);
  }
  @Delete("{key}")
  @Security("project-key", ["kv:write"])
  @Middlewares(validateParams(kvKeyParamsSchema))
  public async delete(@Path() key: string, @Request() request: TypedRequest): Promise<{ success: true }> {
    await this.service.deleteKv(request.projectApiKey!.projectId, key);
    return { success: true };
  }
}

@Route("v1/developer")
@Tags("Developer Service APIs")
export class DeveloperApiController extends Controller {
  private readonly service = DeveloperProjectService.getInstance();
  @Post("verification/send")
  @Security("project-key", ["verification:send"])
  @Middlewares(validateBody(sendVerificationBodySchema))
  public async sendVerification(
    @Body() body: SendDeveloperVerificationDto,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    const forwarded = request.headers["x-forwarded-for"];
    const sourceIp = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : request.ip;
    await this.service.sendVerification(request.projectApiKey!.projectId, body, sourceIp);
    return { success: true };
  }
  @Post("verification/verify")
  @Security("project-key", ["verification:verify"])
  @Middlewares(validateBody(verifyCodeBodySchema))
  public async verifyCode(
    @Body() body: VerifyDeveloperCodeDto,
    @Request() request: TypedRequest,
  ): Promise<{ valid: boolean }> {
    return { valid: await this.service.verifyCode(request.projectApiKey!.projectId, body) };
  }
  @Get("ip/{ip}")
  @Security("project-key", ["ip:lookup"])
  public async lookupIp(@Path() ip: string, @Request() request: TypedRequest) {
    return this.service.lookupIp(request.projectApiKey!.projectId, ip);
  }
  @Post("push")
  @Security("project-key", ["push:send"])
  @Middlewares(validateBody(sendPushBodySchema))
  public async push(
    @Body() body: SendDeveloperPushDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperPushDeliveryDto[]> {
    return this.service.sendPush(request.projectApiKey!.projectId, body);
  }
}

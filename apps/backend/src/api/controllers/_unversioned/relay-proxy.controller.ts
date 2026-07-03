import { Controller, Get, Post, Route, Request, SuccessResponse, Tags, Path, Middlewares } from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import { RelayTokenService } from "@/services/relay/relay-token.service";
import { RelayProxyService } from "@/services/relay/relay-proxy.service";
import { UnauthorizedError } from "@/util/errors";
import { extractRelayToken } from "@/util/relay-auth";
import type { Request as ExpressRequest } from "express";
import { skipResponseWrapper } from "@/util/response-wrapper";
import type { RelayTokenCurrentQuotaDto, RelayTokenCurrentQuotaQueryDto } from "@/api/dto/relay/relay.dto";
import { deprecated } from "@/middleware/api-version";

@Route("relay/proxy")
@Tags("Relay Proxy")
export class RelayProxyController extends Controller {
  private relayTokenService = new RelayTokenService();
  private relayProxyService = new RelayProxyService();

  private async handleRequest(request: ExpressRequest): Promise<any> {
    const token = extractRelayToken(request);
    if (!token) throw new UnauthorizedError("Invalid relay token");

    const relayToken = await this.relayTokenService.validateToken(token, request);

    skipResponseWrapper(request as any);

    const result = await this.relayProxyService.forwardRequest(relayToken, request, request.res);

    this.setStatus(result.status);

    // 过滤掉会导致冲突的响应头
    const headersToSkip = ["content-length", "transfer-encoding", "connection", "keep-alive", "host"];
    Object.entries(result.headers).forEach(([key, value]) => {
      if (!headersToSkip.includes(key.toLowerCase())) this.setHeader(key, value as string);
    });

    return result.data;
  }

  private async handleUsageV2Request(request: ExpressRequest): Promise<RelayTokenCurrentQuotaDto> {
    const token = extractRelayToken(request);
    if (!token) throw new UnauthorizedError("Invalid relay token");

    const relayToken = await this.relayTokenService.validateToken(token, request);

    const query: RelayTokenCurrentQuotaQueryDto = {
      startDate: request.query.startDate as string | undefined,
      endDate: request.query.endDate as string | undefined,
      windowHours: request.query.windowHours ? Number(request.query.windowHours) : undefined,
      resetAt: request.query.resetAt as string | undefined,
      timezoneOffsetMinutes: request.query.timezoneOffsetMinutes
        ? Number(request.query.timezoneOffsetMinutes)
        : undefined,
    };

    return this.relayTokenService.getCurrentTokenQuotaSummary(relayToken, query);
  }

  private async handleUsageV1Request(request: ExpressRequest): Promise<RelayTokenCurrentQuotaDto> {
    const token = extractRelayToken(request);
    if (!token) throw new UnauthorizedError("Invalid relay token");

    const relayToken = await this.relayTokenService.validateToken(token, request);

    // v1 用旧版逻辑：无 allTimeSummary、无 totalSpend、无 range 字段
    return this.relayTokenService.getCurrentTokenQuotaSummaryLegacy(relayToken);
  }

  private async handleModelsRequest(request: ExpressRequest): Promise<any> {
    const token = extractRelayToken(request);
    if (!token) throw new UnauthorizedError("Invalid relay token");

    const relayToken = await this.relayTokenService.validateToken(token, request);
    const filteredModelNames = await this.relayProxyService.getAvailableModelsForToken(relayToken, "openai");

    const created = Math.floor(Date.now() / 1000);
    const response = {
      object: "list",
      data: filteredModelNames.map((modelName) => ({
        id: modelName,
        object: "model",
        created,
        owned_by: "relay",
      })),
    };

    skipResponseWrapper(request as any);

    return response;
  }

  // v1 usage — 无查询参数，基础 quota 汇总
  @Get("v1/usage")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(deprecated({ autoSuccessor: true }))
  public async usageV1(@Request() request: ExpressRequest): Promise<RelayTokenCurrentQuotaDto> {
    return this.handleUsageV1Request(request);
  }

  // v2 usage — 支持时间范围等查询参数
  @Get("v2/usage")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async usageV2(@Request() request: ExpressRequest): Promise<RelayTokenCurrentQuotaDto> {
    return this.handleUsageV2Request(request);
  }

  // 支持任意版本号的 models 路由 (v1, v2, v4, v10 等)
  @Get("v{version}/models")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async modelsVAny(@Path() version: string, @Request() request: ExpressRequest): Promise<any> {
    void version;
    return this.handleModelsRequest(request);
  }

  @Get("models")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async models(@Request() request: ExpressRequest): Promise<any> {
    return this.handleModelsRequest(request);
  }

  // 支持任意版本号的 chat/completions 路由 (v1, v2, v4, v10 等)
  @Post("v{version}/chat/completions")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async openaiVAny(@Path() version: string, @Request() request: ExpressRequest): Promise<any> {
    void version;
    return this.handleRequest(request);
  }

  @Post("chat/completions")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async openai(@Request() request: ExpressRequest): Promise<any> {
    return this.handleRequest(request);
  }

  // 支持任意版本号的 responses 路由
  @Post("v{version}/responses")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async responsesVAny(@Path() version: string, @Request() request: ExpressRequest): Promise<any> {
    void version;
    return this.handleRequest(request);
  }

  @Post("responses")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async responses(@Request() request: ExpressRequest): Promise<any> {
    return this.handleRequest(request);
  }

  // 支持任意版本号的 images/generations 路由
  @Post("v{version}/images/generations")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async imageGenerationsVAny(@Path() version: string, @Request() request: ExpressRequest): Promise<any> {
    void version;
    return this.handleRequest(request);
  }

  @Post("images/generations")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async imageGenerations(@Request() request: ExpressRequest): Promise<any> {
    return this.handleRequest(request);
  }

  // 支持任意版本号的 images/edits 路由
  @Post("v{version}/images/edits")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async imageEditsVAny(@Path() version: string, @Request() request: ExpressRequest): Promise<any> {
    void version;
    return this.handleRequest(request);
  }

  @Post("images/edits")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async imageEdits(@Request() request: ExpressRequest): Promise<any> {
    return this.handleRequest(request);
  }

  // 支持任意版本号的 images/variations 路由
  @Post("v{version}/images/variations")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async imageVariationsVAny(@Path() version: string, @Request() request: ExpressRequest): Promise<any> {
    void version;
    return this.handleRequest(request);
  }

  @Post("images/variations")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async imageVariations(@Request() request: ExpressRequest): Promise<any> {
    return this.handleRequest(request);
  }

  // 支持任意版本号的 messages 路由 (Anthropic)
  @Post("v{version}/messages")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async anthropicVAny(@Path() version: string, @Request() request: ExpressRequest): Promise<any> {
    void version;
    return this.handleRequest(request);
  }

  @Post("messages")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async anthropic(@Request() request: ExpressRequest): Promise<any> {
    return this.handleRequest(request);
  }

  // 支持任意版本号的 Gemini 路由 (v1, v2, v4, v1beta 等)
  @Post("v{version}/models/{modelAndAction}")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async geminiVAny(
    @Path() version: string,
    @Path() modelAndAction: string,
    @Request() request: ExpressRequest,
  ): Promise<any> {
    void version;
    void modelAndAction;
    return this.handleRequest(request);
  }

  @Post("v{version}/models/{model}/generateContent")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async geminiVAnyGenerateContent(
    @Path() version: string,
    @Path() model: string,
    @Request() request: ExpressRequest,
  ): Promise<any> {
    void version;
    void model;
    return this.handleRequest(request);
  }

  @Post("v{version}/models/{model}/streamGenerateContent")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async geminiVAnyStreamGenerateContent(
    @Path() version: string,
    @Path() model: string,
    @Request() request: ExpressRequest,
  ): Promise<any> {
    void version;
    void model;
    return this.handleRequest(request);
  }
}

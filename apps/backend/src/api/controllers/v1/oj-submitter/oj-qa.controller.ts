import { Controller, Post, Get, Route, Security, Body, Query, Request, Tags, Header, Middlewares } from "@tsoa/runtime";
import { OJQAService } from "@/services/oj-submitter/oj-qa.service";
import type { AskQuestionRequest, AskQuestionResponse, OJUsageStatsDto } from "@/api/dto/oj-submitter/oj-qa.dto";
import type { TypedRequest } from "@/types/express";
import { BadRequestError, UnauthorizedError } from "@/util/errors";
import { askQuestionBodySchema, ojUsageQuerySchema } from "@/api/schema/oj-submitter/oj-submitter.schema";
import { validateBody, validateQuery } from "@/middleware/validation";

@Route("v1/products/oj-submitter")
@Tags("OJSubmitter")
export class OJQAController extends Controller {
  private ojQAService = OJQAService.getInstance();

  /**
   * OJSubmitter AI问答接口
   * 使用API Key认证（通过X-API-Key header）
   */
  @Post("ask")
  @Middlewares(validateBody(askQuestionBodySchema))
  public async askQuestion(
    @Header("X-API-Key") apiKey: string,
    @Body() body: AskQuestionRequest,
    @Request() request: TypedRequest,
  ): Promise<AskQuestionResponse> {
    if (!apiKey) throw new UnauthorizedError("API key is required in X-API-Key header");
    if (!body.question) throw new BadRequestError("Question is required in the request body");
    if (!body.model) body.model = "gpt-3.5-turbo"; // 默认模型
    const ipAddress = request.ip || "unknown";

    const result = await this.ojQAService.askQuestion(apiKey, body.question, body.model, body.maxTokens, ipAddress);

    return {
      answer: result.answer,
      tokensUsed: result.tokensUsed,
      cost: result.cost,
    };
  }

  /**
   * 获取当前用户的使用统计
   */
  @Get("usage")
  @Security("jwt")
  @Middlewares(validateQuery(ojUsageQuerySchema))
  public async getUsageStats(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() startTime?: string,
    @Query() endTime?: string,
  ): Promise<OJUsageStatsDto> {
    const userId = request.user!.userId;

    const start = startTime ? new Date(startTime) : undefined;
    const end = endTime ? new Date(endTime) : undefined;

    const stats = await this.ojQAService.getUsageStats(userId, page || 1, pageSize || 20, start, end);

    return {
      totalTokens: stats.totalTokens,
      totalCost: stats.totalCost,
      requestCount: stats.requestCount,
      avgTokensPerRequest: stats.avgTokensPerRequest,
      avgCostPerRequest: stats.avgCostPerRequest,
      usages: stats.records.map((r) => ({
        id: r.id,
        model: r.model,
        question: r.question,
        answer: r.answer,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        totalTokens: r.totalTokens,
        cost: Number(r.cost),
        createTime: r.createTime,
      })),
    };
  }
}

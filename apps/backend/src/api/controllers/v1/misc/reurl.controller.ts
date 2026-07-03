import { Body, Controller, Post, Request, Route, Security, SuccessResponse, Tags, Middlewares } from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import type { GenerateReURLRequest, GenerateReURLResponse } from "@/api/dto/system/reurl.dto";
import { ReURLService } from "@/services/system/reurl.service";
import { BadRequestError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
import { generateReURLBodySchema } from "@/api/schema/system/reurl.schema";
import { validateBody } from "@/middleware/validation";
import { ReplayProtected, replayProtectionMiddleware } from "@/util/replay-protected-decorator";

/**
 * ReURL 短链接控制器
 */
@Route("v1/reurl")
@Tags("ReURL")
export class ReURLController extends Controller {
  private reurlService = ReURLService.getInstance();

  /**
   * 生成 ReURL 短链接
   *
   * @summary 生成临时访问短链接
   * @param request Express Request 对象
   * @param requestBody 请求参数
   * @returns ReURL 信息
   */
  @Post("generate")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "成功生成 ReURL")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateBody(generateReURLBodySchema))
  public async generateReURL(
    @Request() request: TypedRequest,
    @Body() requestBody: GenerateReURLRequest,
  ): Promise<GenerateReURLResponse> {
    const { ttl = 60, token: providedToken } = requestBody;

    // 验证 TTL 范围
    if (ttl <= 0) throw new BadRequestError("TTL 必须大于 0");

    // 建议最大 TTL 为 1 小时（3600 秒）
    if (ttl > 3600) throw new BadRequestError("TTL 不能超过 3600 秒（1 小时）");

    // 获取 JWT token
    let token: string;
    if (providedToken)
      // 使用提供的 token
      token = providedToken;
    else {
      // 从 Authorization header 获取当前用户的 token
      const authHeader = request.headers["authorization"];
      if (!authHeader || !authHeader.startsWith("Bearer "))
        throw new BadRequestError("未提供 token 且无法从请求头获取");

      token = authHeader.replace("Bearer ", "").trim();
    }

    // 生成 reurl
    const reurlId = this.reurlService.generateReURL(token, ttl);

    this.setStatus(HttpStatusCode.Ok);

    return {
      reurl: reurlId,
      expires_in: ttl,
      usage: `?token=reurl:${reurlId}`,
    };
  }
}

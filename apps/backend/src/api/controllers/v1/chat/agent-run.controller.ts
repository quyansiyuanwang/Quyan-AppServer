import { Body, Controller, Post, Request, Path, Route, Security, Tags, Middlewares } from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import type { TypedRequest } from "@/types/express";
import type { SuccessResponse } from "@/api/response";
import type { CreateAgentRunRequest, AgentRunResponse } from "@/api/dto/agent/agent.dto";
import { createAgentRunBodySchema } from "@/api/schema/agent/agent.schema";
import { validateBody } from "@/middleware/validation";
import { AgentService } from "@/services/agent/agent.service";
import { Permission } from "@/constant/permission";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { ReplayProtected, replayProtectionMiddleware } from "@/util/replay-protected-decorator";

@Route("v1/chat/conversations")
@Tags("Agent")
export class AgentRunController extends Controller {
  private readonly service = AgentService.getInstance();

  @Post("{conversationId}/agent-runs")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateBody(createAgentRunBodySchema))
  @RequirePermission(Permission.AGENT_TASK_RUN)
  async createRun(
    @Path() conversationId: string,
    @Body() body: CreateAgentRunRequest,
    @Request() request: TypedRequest,
  ): Promise<SuccessResponse<AgentRunResponse>> {
    this.setStatus(HttpStatusCode.Accepted);
    return {
      code: 0,
      message: "Success",
      data: await this.service.createRun(request.user!.userId, conversationId, body),
    };
  }
}

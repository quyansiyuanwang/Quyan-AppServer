import {
  Body,
  Controller,
  Get,
  Middlewares,
  Path,
  Post,
  Delete,
  Query,
  Request,
  Route,
  Security,
  Tags,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import { AgentService } from "@/services/agent/agent.service";
import type { TypedRequest } from "@/types/express";
import type { SuccessResponse } from "@/api/response";
import type {
  CreateAgentWorkspaceRequest,
  AgentWorkspaceResponse,
  CreateMcpServerRequest,
  McpServerResponse,
  AgentApprovalResponse,
  DecideAgentApprovalRequest,
  CreateAgentMachineRequest,
  AgentMachineResponse,
} from "@/api/dto/agent/agent.dto";
import {
  createAgentWorkspaceBodySchema,
  createMcpServerBodySchema,
  decideAgentApprovalBodySchema,
  createAgentMachineBodySchema,
} from "@/api/schema/agent/agent.schema";
import { validateBody } from "@/middleware/validation";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import { ReplayProtected, replayProtectionMiddleware } from "@/util/replay-protected-decorator";
import { SSEStreamService } from "@/util/streaming/sse";
import { skipResponseWrapper } from "@/util/response-wrapper";

@Route("v1/agent")
@Tags("Agent")
export class AgentController extends Controller {
  private readonly service = AgentService.getInstance();
  private readonly sse = SSEStreamService.getInstance();

  @Get("machines")
  @Security("jwt")
  @RequirePermission(Permission.AGENT_WORKSPACE_READ)
  async listMachines(@Request() request: TypedRequest): Promise<SuccessResponse<AgentMachineResponse[]>> {
    return { code: 0, message: "Success", data: await this.service.listMachines(request.user!.userId) };
  }

  @Post("machines")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateBody(createAgentMachineBodySchema))
  @RequirePermission(Permission.AGENT_WORKSPACE_WRITE)
  async createMachine(
    @Body() body: CreateAgentMachineRequest,
    @Request() request: TypedRequest,
  ): Promise<SuccessResponse<AgentMachineResponse>> {
    this.setStatus(HttpStatusCode.Created);
    return { code: 0, message: "Success", data: await this.service.createMachine(request.user!.userId, body) };
  }

  @Delete("machines/{machineId}")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  @RequirePermission(Permission.AGENT_WORKSPACE_WRITE)
  async deleteMachine(@Path() machineId: string, @Request() request: TypedRequest): Promise<SuccessResponse<void>> {
    await this.service.deleteMachine(request.user!.userId, machineId);
    return { code: 0, message: "Success" };
  }

  @Get("workspaces")
  @Security("jwt")
  @RequirePermission(Permission.AGENT_WORKSPACE_READ)
  async listWorkspaces(@Request() request: TypedRequest): Promise<SuccessResponse<AgentWorkspaceResponse[]>> {
    return { code: 0, message: "Success", data: await this.service.listWorkspaces(request.user!.userId) };
  }

  @Post("workspaces")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateBody(createAgentWorkspaceBodySchema))
  @RequirePermission(Permission.AGENT_WORKSPACE_WRITE)
  async createWorkspace(
    @Body() body: CreateAgentWorkspaceRequest,
    @Request() request: TypedRequest,
  ): Promise<SuccessResponse<AgentWorkspaceResponse>> {
    this.setStatus(HttpStatusCode.Created);
    return { code: 0, message: "Success", data: await this.service.createWorkspace(request.user!.userId, body) };
  }

  @Delete("workspaces/{workspaceId}")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  @RequirePermission(Permission.AGENT_WORKSPACE_WRITE)
  async destroyWorkspace(
    @Path() workspaceId: string,
    @Request() request: TypedRequest,
  ): Promise<SuccessResponse<void>> {
    await this.service.stopWorkspace(request.user!.userId, workspaceId, true);
    return { code: 0, message: "Success" };
  }

  @Get("mcp-servers")
  @Security("jwt")
  @RequirePermission(Permission.MCP_SERVER_READ)
  async listMcpServers(@Request() request: TypedRequest): Promise<SuccessResponse<McpServerResponse[]>> {
    return { code: 0, message: "Success", data: await this.service.listMcpServers(request.user!.userId) };
  }

  @Post("mcp-servers")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateBody(createMcpServerBodySchema))
  @RequirePermission(Permission.MCP_SERVER_WRITE)
  async createMcpServer(
    @Body() body: CreateMcpServerRequest,
    @Request() request: TypedRequest,
  ): Promise<SuccessResponse<McpServerResponse>> {
    this.setStatus(HttpStatusCode.Created);
    return { code: 0, message: "Success", data: await this.service.createMcpServer(request.user!.userId, body) };
  }

  @Post("runs/{taskId}/cancel")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  @RequirePermission(Permission.AGENT_TASK_RUN)
  async cancelRun(@Path() taskId: string, @Request() request: TypedRequest): Promise<SuccessResponse<void>> {
    await this.service.cancelRun(request.user!.userId, taskId);
    return { code: 0, message: "Success" };
  }

  @Get("runs/{taskId}/approvals")
  @Security("jwt")
  @RequirePermission(Permission.AGENT_APPROVAL)
  async listApprovals(
    @Path() taskId: string,
    @Request() request: TypedRequest,
  ): Promise<SuccessResponse<AgentApprovalResponse[]>> {
    return { code: 0, message: "Success", data: await this.service.getApprovals(request.user!.userId, taskId) };
  }

  @Post("runs/{taskId}/approvals/{approvalId}")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateBody(decideAgentApprovalBodySchema))
  @RequirePermission(Permission.AGENT_APPROVAL)
  async decideApproval(
    @Path() taskId: string,
    @Path() approvalId: string,
    @Body() body: DecideAgentApprovalRequest,
    @Request() request: TypedRequest,
  ): Promise<SuccessResponse<void>> {
    await this.service.decideApproval(request.user!.userId, taskId, approvalId, body.decision);
    return { code: 0, message: "Success" };
  }

  @Get("runs/{taskId}/events")
  @Security("jwt")
  @RequirePermission(Permission.AGENT_TASK_RUN)
  async streamEvents(@Path() taskId: string, @Query() after = 0, @Request() request: TypedRequest): Promise<void> {
    if (!request.res) throw new Error("Missing response object");
    skipResponseWrapper(request);
    const res = request.res;
    this.sse.initStream(res);
    let cursor = Number(after) || 0;
    let idle = 0;
    try {
      while (!res.writableEnded && !res.destroyed && idle < 600) {
        const events = await this.service.listEvents(request.user!.userId, taskId, cursor);
        if (events.length) {
          idle = 0;
          for (const event of events) {
            cursor = event.sequence;
            this.sse.sendChunk(res, { ...(event.payload as object), sequence: event.sequence });
          }
        } else idle += 1;
        if (events.some((event) => ["complete", "error"].includes(event.eventType))) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!res.writableEnded && !res.destroyed) {
        this.sse.sendChunk(res, { type: "done", done: true });
        this.sse.sendDone(res);
      }
    } finally {
      if (!res.writableEnded && !res.destroyed) this.sse.endStream(res);
    }
  }
}

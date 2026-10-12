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
  Response,
  SuccessResponse,
  Tags,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import { AgentService } from "@/services/agent/agent.service";
import type { TypedRequest } from "@/types/express";
import type { SuccessResponse as ApiSuccessResponse } from "@/api/response";
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
import { CheckPermission, PermissionCheckMode } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import { ReplayProtected, replayProtectionMiddleware } from "@/util/replay-protected-decorator";
import { SSEStreamService } from "@/util/streaming/sse";
import { skipResponseWrapper } from "@/util/response-wrapper";

import { iamCollectionAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import { iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";

import { AGENT_TASK_LIMITS } from "@/services/agent/agent-task.policy";
import {
  agentMachineResourceResolver,
  agentWorkspaceResourceResolver,
  agentTaskResourceResolver,
  agentApprovalResourcesResolver,
} from "@/iam/request/agent-resource-resolvers";

@Route("v1/agent")
@Tags("Agent")
export class AgentController extends Controller {
  private readonly service = AgentService.getInstance();
  private readonly sse = SSEStreamService.getInstance();

  @Get("machines")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:agent:ListMachines",
      resourceKind: "collection",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  async listMachines(@Request() request: TypedRequest): Promise<ApiSuccessResponse<AgentMachineResponse[]>> {
    return { code: 0, message: "Success", data: await this.service.listMachines(request.user!.userId, request) };
  }

  @Post("machines")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateBody(createAgentMachineBodySchema))
  @CheckPermission(Permission.AGENT_WORKSPACE_WRITE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:agent:CreateMachine",
    resourceKind: "single-resource",
    resource: iamAuthenticatedUserResourceResolver,
  })
  async createMachine(
    @Body() body: CreateAgentMachineRequest,
    @Request() request: TypedRequest,
  ): Promise<ApiSuccessResponse<AgentMachineResponse>> {
    this.setStatus(HttpStatusCode.Created);
    return { code: 0, message: "Success", data: await this.service.createMachine(request.user!.userId, body, request) };
  }

  @Delete("machines/{machineId}")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  @CheckPermission(Permission.AGENT_WORKSPACE_WRITE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:agent:DeleteMachine",
    resourceKind: "single-resource",
    resource: agentMachineResourceResolver,
  })
  async deleteMachine(@Path() machineId: string, @Request() request: TypedRequest): Promise<ApiSuccessResponse<void>> {
    await this.service.deleteMachine(request.user!.userId, machineId, request);
    return { code: 0, message: "Success" };
  }

  @Get("workspaces")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:agent:ListWorkspaces",
      resourceKind: "collection",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  async listWorkspaces(@Request() request: TypedRequest): Promise<ApiSuccessResponse<AgentWorkspaceResponse[]>> {
    return { code: 0, message: "Success", data: await this.service.listWorkspaces(request.user!.userId, request) };
  }

  @Post("workspaces")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateBody(createAgentWorkspaceBodySchema))
  @CheckPermission(Permission.AGENT_WORKSPACE_WRITE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:agent:CreateWorkspace",
    resourceKind: "single-resource",
    resource: iamAuthenticatedUserResourceResolver,
  })
  async createWorkspace(
    @Body() body: CreateAgentWorkspaceRequest,
    @Request() request: TypedRequest,
  ): Promise<ApiSuccessResponse<AgentWorkspaceResponse>> {
    this.setStatus(HttpStatusCode.Created);
    return {
      code: 0,
      message: "Success",
      data: await this.service.createWorkspace(request.user!.userId, body, request),
    };
  }

  @Delete("workspaces/{workspaceId}")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  @CheckPermission(Permission.AGENT_WORKSPACE_WRITE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:agent:DeleteWorkspace",
    resourceKind: "single-resource",
    resource: agentWorkspaceResourceResolver,
  })
  async destroyWorkspace(
    @Path() workspaceId: string,
    @Request() request: TypedRequest,
  ): Promise<ApiSuccessResponse<void>> {
    await this.service.stopWorkspace(request.user!.userId, workspaceId, true, request);
    return { code: 0, message: "Success" };
  }

  @Get("mcp-servers")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:mcp:ListServers",
      resourceKind: "collection",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  async listMcpServers(@Request() request: TypedRequest): Promise<ApiSuccessResponse<McpServerResponse[]>> {
    return { code: 0, message: "Success", data: await this.service.listMcpServers(request.user!.userId, request) };
  }

  @Post("mcp-servers")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateBody(createMcpServerBodySchema))
  @CheckPermission(Permission.MCP_SERVER_WRITE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:mcp:CreateServer",
    resourceKind: "single-resource",
    resource: iamAuthenticatedUserResourceResolver,
  })
  async createMcpServer(
    @Body() body: CreateMcpServerRequest,
    @Request() request: TypedRequest,
  ): Promise<ApiSuccessResponse<McpServerResponse>> {
    this.setStatus(HttpStatusCode.Created);
    return {
      code: 0,
      message: "Success",
      data: await this.service.createMcpServer(request.user!.userId, body, request),
    };
  }

  @Post("runs/{taskId}/cancel")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  @CheckPermission(Permission.AGENT_TASK_RUN, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:agent:CancelTask",
    resourceKind: "single-resource",
    resource: agentTaskResourceResolver,
  })
  async cancelRun(@Path() taskId: string, @Request() request: TypedRequest): Promise<ApiSuccessResponse<void>> {
    await this.service.cancelRun(request.user!.userId, taskId, request);
    return { code: 0, message: "Success" };
  }

  @Get("runs/{taskId}/approvals")
  @Security("jwt")
  @CheckPermission(Permission.AGENT_APPROVAL, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:agent:ListTaskApprovals",
    resourceKind: "single-resource",
    resource: agentTaskResourceResolver,
  })
  async listApprovals(
    @Path() taskId: string,
    @Request() request: TypedRequest,
  ): Promise<ApiSuccessResponse<AgentApprovalResponse[]>> {
    return {
      code: 0,
      message: "Success",
      data: await this.service.getApprovals(request.user!.userId, taskId, request),
    };
  }

  @Post("runs/{taskId}/approvals/{approvalId}")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateBody(decideAgentApprovalBodySchema))
  @CheckPermission(Permission.AGENT_APPROVAL, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:agent:DecideApproval",
    resourceKind: "batch",
    resource: agentApprovalResourcesResolver,
  })
  async decideApproval(
    @Path() taskId: string,
    @Path() approvalId: string,
    @Body() body: DecideAgentApprovalRequest,
    @Request() request: TypedRequest,
  ): Promise<ApiSuccessResponse<void>> {
    await this.service.decideApproval(request.user!.userId, taskId, approvalId, body.decision, request);
    return { code: 0, message: "Success" };
  }

  @Get("runs/{taskId}/events")
  @Security("jwt")
  @CheckPermission(Permission.AGENT_TASK_RUN, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:agent:GetTaskEvents",
    resourceKind: "single-resource",
    resource: agentTaskResourceResolver,
  })
  @SuccessResponse(HttpStatusCode.Ok, "SSE stream")
  @Response(HttpStatusCode.NoContent, "No content")
  async streamEvents(@Path() taskId: string, @Query() after = 0, @Request() request: TypedRequest): Promise<void> {
    if (!request.res) throw new Error("Missing response object");
    const initialEvents = await this.service.listEvents(request.user!.userId, taskId, after, request);
    skipResponseWrapper(request);
    const res = request.res;
    this.sse.initStream(res);
    let cursor = after;
    let initial = true;
    let idle = 0;
    try {
      while (!res.writableEnded && !res.destroyed && idle < AGENT_TASK_LIMITS.streamMaxIdlePolls) {
        const events = initial
          ? initialEvents
          : await this.service.listEvents(request.user!.userId, taskId, cursor, request);
        initial = false;
        if (events.length) {
          idle = 0;
          for (const event of events) {
            await this.service.assertTaskEventsAuthorized(request.user!.userId, taskId, request);
            cursor = event.sequence;
            await this.sse.sendChunk(res, { ...(event.payload as object), sequence: event.sequence });
          }
        } else idle += 1;
        if (events.some((event) => ["complete", "error"].includes(event.eventType))) break;
        await new Promise((resolve) => setTimeout(resolve, AGENT_TASK_LIMITS.streamPollIntervalMs));
      }
      if (!res.writableEnded && !res.destroyed) {
        await this.sse.sendChunk(res, { type: "done", done: true });
        await this.sse.sendDone(res);
      }
    } finally {
      if (!res.writableEnded && !res.destroyed) this.sse.endStream(res);
    }
  }
}

import { Middlewares, Body, Controller, Post, Request, Response, Route, SuccessResponse, Tags } from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import type { ErrorResponse } from "@/api/response";
import type {
  RemoteTerminalAgentHeartbeatRequest,
  RemoteTerminalAgentHeartbeatResponse,
  RemoteTerminalAgentRegistrationRequest,
  RemoteTerminalAgentRegistrationResponse,
} from "@/modules/remote-terminal/protocol";
import { RemoteTerminalGatewayService } from "@/modules/remote-terminal/gateway/gateway.service";
import type { TypedRequest } from "@/types/express";
import { BadRequestError } from "@/util/errors";
import { skipResponseWrapper } from "@/util/response-wrapper";

@Route("v1/remote-terminal/agent")
@Tags("Remote Terminal Agent")
export class RemoteTerminalAgentController extends Controller {
  private gatewayService = RemoteTerminalGatewayService.getInstance();

  @Post("register")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "请求参数错误")
  public async register(
    @Body() body: RemoteTerminalAgentRegistrationRequest,
    @Request() request: TypedRequest,
  ): Promise<RemoteTerminalAgentRegistrationResponse> {
    skipResponseWrapper(request);

    try {
      return await this.gatewayService.registerAgent(body);
    } catch (error) {
      throw new BadRequestError(error instanceof Error ? error.message : "Agent registration failed");
    }
  }

  @Post("heartbeat")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "请求参数错误")
  public async heartbeat(
    @Body() body: RemoteTerminalAgentHeartbeatRequest,
    @Request() request: TypedRequest,
  ): Promise<RemoteTerminalAgentHeartbeatResponse> {
    skipResponseWrapper(request);

    try {
      return await this.gatewayService.heartbeatAgent(body);
    } catch (error) {
      throw new BadRequestError(error instanceof Error ? error.message : "Agent heartbeat failed");
    }
  }
}

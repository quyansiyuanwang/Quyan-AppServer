import {
  Body,
  Controller,
  Delete,
  Get,
  Middlewares,
  Path,
  Post,
  Put,
  Request,
  Route,
  Security,
  Tags,
} from "@tsoa/runtime";
import type { TypedRequest } from "@/types/express.d";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { validateBody, validateParams } from "@/middleware/validation";
import {
  createLegalPolicyBodySchema,
  legalPolicyIdParamsSchema,
  updateLegalPolicyBodySchema,
} from "@/api/schema/legal-policy/legal-policy.schema";
import type {
  CreateLegalPolicyDto,
  LegalPolicyDto,
  LegalPolicyListItemDto,
  UpdateLegalPolicyDto,
} from "@/api/dto/legal-policy/legal-policy.dto";
import { LegalPolicyService } from "@/services/legal-policy/legal-policy.service";

@Route("v1/legal-policies")
@Tags("Legal Policy Management")
export class LegalPolicyController extends Controller {
  private service = LegalPolicyService.getInstance();

  @Post("")
  @Security("jwt")
  @RequirePermission(Permission.LEGAL_POLICY_CREATE)
  @Middlewares(replayProtectionMiddleware, validateBody(createLegalPolicyBodySchema))
  public async createPolicy(
    @Body() body: CreateLegalPolicyDto,
    @Request() request: TypedRequest,
  ): Promise<LegalPolicyDto> {
    return this.service.createPolicy(body, request.user!.userId, request);
  }

  @Get("")
  @Security("jwt")
  @RequirePermission(Permission.LEGAL_POLICY_READ)
  public async listPolicies(@Request() request: TypedRequest): Promise<LegalPolicyListItemDto[]> {
    void request;
    return this.service.listPolicies();
  }

  @Get("{id}")
  @Security("jwt")
  @RequirePermission(Permission.LEGAL_POLICY_READ)
  @Middlewares(validateParams(legalPolicyIdParamsSchema))
  public async getPolicy(@Path() id: string): Promise<LegalPolicyDto> {
    return this.service.getPolicy(id);
  }

  @Put("{id}")
  @Security("jwt")
  @RequirePermission(Permission.LEGAL_POLICY_UPDATE)
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(legalPolicyIdParamsSchema),
    validateBody(updateLegalPolicyBodySchema),
  )
  public async updatePolicy(
    @Path() id: string,
    @Body() body: UpdateLegalPolicyDto,
    @Request() request: TypedRequest,
  ): Promise<LegalPolicyDto> {
    return this.service.updatePolicy(id, body, request.user!.userId, request);
  }

  @Delete("{id}")
  @Security("jwt")
  @RequirePermission(Permission.LEGAL_POLICY_DELETE)
  @Middlewares(replayProtectionMiddleware, validateParams(legalPolicyIdParamsSchema))
  public async deletePolicy(@Path() id: string, @Request() request: TypedRequest): Promise<{ success: boolean }> {
    await this.service.deletePolicy(id, request.user!.userId, request);
    return { success: true };
  }

  @Post("{id}/publish")
  @Security("jwt")
  @RequirePermission(Permission.LEGAL_POLICY_PUBLISH)
  @Middlewares(replayProtectionMiddleware, validateParams(legalPolicyIdParamsSchema))
  public async publishPolicy(@Path() id: string, @Request() request: TypedRequest): Promise<LegalPolicyDto> {
    return this.service.publishPolicy(id, request.user!.userId, request);
  }

  @Post("{id}/unpublish")
  @Security("jwt")
  @RequirePermission(Permission.LEGAL_POLICY_PUBLISH)
  @Middlewares(replayProtectionMiddleware, validateParams(legalPolicyIdParamsSchema))
  public async unpublishPolicy(@Path() id: string, @Request() request: TypedRequest): Promise<LegalPolicyDto> {
    return this.service.unpublishPolicy(id, request.user!.userId, request);
  }
}

import { Body, Controller, Middlewares, Post, Route, Tags } from "@tsoa/runtime";
import type { CurrentLegalPoliciesResponse, GetCurrentLegalPoliciesDto } from "@/api/dto/legal-policy/legal-policy.dto";
import { LegalPolicyService } from "@/services/legal-policy/legal-policy.service";
import { validateBody } from "@/middleware/validation";
import { getCurrentLegalPoliciesBodySchema } from "@/api/schema/legal-policy/legal-policy.schema";
import { CaptchaProtected, captchaMiddleware } from "@/util/captcha-protected-decorator";

@Route("v1/public/legal-policies")
@Tags("Public Legal Policy")
export class PublicLegalPolicyController extends Controller {
  private service = LegalPolicyService.getInstance();

  /**
   * 获取当前生效的服务协议与隐私政策（需通过 reCAPTCHA 验证）
   */
  @Post("current")
  @CaptchaProtected({ action: "view_policy", trustOnly: true })
  @Middlewares(
    validateBody(getCurrentLegalPoliciesBodySchema),
    captchaMiddleware({ action: "view_policy", trustOnly: true }),
  )
  public async getCurrentPolicies(@Body() body: GetCurrentLegalPoliciesDto): Promise<CurrentLegalPoliciesResponse> {
    return this.service.getCurrentPolicies(body.policyType);
  }
}

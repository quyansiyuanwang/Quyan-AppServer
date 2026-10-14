import type { IamConditionContext, IamPrincipal } from "@quyan/shared";
import { IamResourceConditionService } from "../condition/resource-condition.service";
import { IAM_ASSUME_ROLE_ACTION, evaluateIamTrustPolicy, parseIamTrustPolicy } from "./trust-policy";
/** Trust and identity decisions derive resource facts through the same live provider. */
export class IamTrustAuthorizationService {
  private static instance: IamTrustAuthorizationService;
  static getInstance() {
    return (this.instance ??= new IamTrustAuthorizationService());
  }
  constructor(
    private readonly resources: Pick<
      IamResourceConditionService,
      "contexts"
    > = IamResourceConditionService.getInstance(),
  ) {}
  async evaluate(input: unknown, request: { principal: IamPrincipal; roleArn: string; context?: IamConditionContext }) {
    const document = parseIamTrustPolicy(input).document;
    const [context] = await this.resources.contexts({
      principal: request.principal,
      action: IAM_ASSUME_ROLE_ACTION,
      resources: [request.roleArn],
      policies: [{ policyId: "trust:resource-context", document }],
      context: request.context,
    });
    if (!context)
      return { decision: "ImplicitDeny" as const, reason: "invalid-request" as const, matchedStatements: [] };
    return evaluateIamTrustPolicy(input, { ...request, context });
  }
}

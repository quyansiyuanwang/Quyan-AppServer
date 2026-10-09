import {
  IAM_CONDITION_KEY_CATALOG,
  getIamActionDefinition,
  getIamConditionKey,
  getIamResourceType,
} from "@quyan/shared";
import type { IamConditionContext, IamPrincipal } from "@quyan/shared";
import { ArticleManagementRepository } from "@/store/content/article-management.repository";
import { principalConditionContext } from "../request/condition-context";
import type { IamPolicyInput } from "../evaluator/policy-evaluator";

/** A registered key is not permission to trust caller attributes. Resource facts are always read from storage. */
export class IamResourceConditionService {
  private static instance: IamResourceConditionService;
  constructor(
    private readonly articles: Pick<
      ArticleManagementRepository,
      "findAvailableTargets"
    > = ArticleManagementRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new IamResourceConditionService());
  }
  async contexts(input: {
    principal: IamPrincipal;
    action: string;
    resources: readonly string[];
    policies: readonly IamPolicyInput[];
    context?: IamConditionContext;
  }): Promise<(IamConditionContext | undefined)[]> {
    const context = principalConditionContext(input.principal);
    for (const key of IAM_CONDITION_KEY_CATALOG)
      if (key.supported && key.source === "request" && input.context && Object.hasOwn(input.context, key.key))
        context[key.key] = input.context[key.key];
    const neededResourceKeys = new Set(
      input.policies
        .flatMap((policy) =>
          policy.document.Statement.flatMap((statement) =>
            Object.values(statement.Condition ?? {}).flatMap((clause) => Object.keys(clause)),
          ),
        )
        .filter(
          (key) =>
            getIamConditionKey(key)?.source === "resource" &&
            getIamActionDefinition(input.action)?.conditionKeys.includes(key),
        ),
    );
    if (!neededResourceKeys.size) return input.resources.map(() => ({ ...context }));
    const ids = [
      ...new Set(
        input.resources
          .filter((resource) => getIamResourceType(resource)?.id === "article/article")
          .map((resource) => resource.split(":")[4].slice("article/".length)),
      ),
    ];
    const targets = ids.length ? await this.articles.findAvailableTargets(ids, input.principal.accountOwnerId) : [];
    const byId = new Map(targets.map((target) => [target.id, target]));
    return input.resources.map((resource) => {
      if (getIamResourceType(resource)?.id !== "article/article") return { ...context };
      const target = byId.get(resource.split(":")[4].slice("article/".length));
      // Missing, foreign, deleted and case-alias resources cannot be rescued by a second unconditional Allow.
      if (!target) return undefined;
      return {
        ...context,
        ...(neededResourceKeys.has("quyan:ResourceOwnerId") ? { "quyan:ResourceOwnerId": target.authorId } : {}),
        ...(neededResourceKeys.has("quyan:ArticlePublishStatus")
          ? { "quyan:ArticlePublishStatus": target.publishStatus }
          : {}),
      };
    });
  }
}

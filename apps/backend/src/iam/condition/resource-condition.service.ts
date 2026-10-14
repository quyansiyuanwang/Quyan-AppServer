import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import type { RamResourceGroupStore } from "@/store/users/ram-resource-group.store";
import {
  IAM_CONDITION_KEY_CATALOG,
  getIamActionDefinition,
  getIamConditionKey,
  getIamResourceType,
} from "@quyan/shared";
import type { IamConditionContext, IamPrincipal } from "@quyan/shared";
import { ArticleManagementRepository } from "@/store/content/article-management.repository";
import { principalConditionContext } from "../request/condition-context";
import { matchIamPattern } from "../evaluator/wildcard-matcher";
import type { IamPolicyInput } from "../evaluator/policy-evaluator";

/** A registered key is not permission to trust caller attributes. Resource facts are always read from storage. */
export class IamResourceConditionService {
  private static instance: IamResourceConditionService;
  constructor(
    private readonly articles: Pick<
      ArticleManagementRepository,
      "findAvailableTargets"
    > = ArticleManagementRepository.getInstance(),
    private readonly resourceGroups: Pick<
      RamResourceGroupStore,
      "conditionMemberships" | "resourceExistsInAccount"
    > = RamResourceGroupRepository.getInstance(),
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
          policy.document.Statement.filter((statement) =>
            statement.Action.some((pattern) => matchIamPattern(pattern, input.action)),
          ).flatMap((statement) => Object.values(statement.Condition ?? {}).flatMap((clause) => Object.keys(clause))),
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
    const groupResources = neededResourceKeys.has("quyan:ResourceGroupId")
      ? [...new Set(input.resources.filter((resource) => getIamResourceType(resource)?.resourceGroupCondition))]
      : [];
    const groupMemberships = groupResources.length
      ? await this.resourceGroups.conditionMemberships(input.principal.accountOwnerId, groupResources)
      : new Map<string, string[]>();
    const validGroupResources = new Set(
      (
        await Promise.all(
          groupResources.map(async (resource) =>
            (await this.resourceGroups.resourceExistsInAccount(resource, input.principal.accountOwnerId))
              ? resource
              : undefined,
          ),
        )
      ).filter((resource): resource is string => resource !== undefined),
    );
    return input.resources.map((resource) => {
      const resolved = { ...context };
      if (neededResourceKeys.has("quyan:ResourceGroupId")) {
        if (getIamResourceType(resource)?.resourceGroupCondition && !validGroupResources.has(resource))
          return undefined;
        resolved["quyan:ResourceGroupId"] = groupMemberships.get(resource) ?? [];
      }
      if (getIamResourceType(resource)?.id !== "article/article") return resolved;
      const target = byId.get(resource.split(":")[4].slice("article/".length));
      // Missing, foreign, deleted and case-alias resources cannot be rescued by a second unconditional Allow.
      if (!target) return undefined;
      return {
        ...resolved,
        ...(neededResourceKeys.has("quyan:ResourceOwnerId") ? { "quyan:ResourceOwnerId": target.authorId } : {}),
        ...(neededResourceKeys.has("quyan:ArticlePublishStatus")
          ? { "quyan:ArticlePublishStatus": target.publishStatus }
          : {}),
      };
    });
  }
}

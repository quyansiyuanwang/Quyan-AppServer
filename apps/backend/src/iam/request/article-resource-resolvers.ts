import { reorderArticlesBodySchema } from "@/api/schema/article/article.schema";
import type { BatchResourceResolver, ResourceResolver } from "./resource-resolvers";
import { articleArn, isCanonicalArticleId } from "../resources/article-resources";
import { ArticleManagementRepository } from "@/store/content/article-management.repository";
/** Account identity comes exclusively from authentication; stored author ownership is checked first. */
export const articleSlugResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const slug = request.params.slug;
  if (typeof slug !== "string" || !/^[a-z0-9_-]{1,200}$/.test(slug)) return undefined;
  const target = await ArticleManagementRepository.getInstance().findTargetBySlug(slug, principal.accountOwnerId);
  return target ? articleArn(principal.accountOwnerId, target.id) : undefined;
};

export const articleResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const id = request.params.id;
  if (!isCanonicalArticleId(id)) return undefined;
  const target = await ArticleManagementRepository.getInstance().findTarget(id, principal.accountOwnerId);
  return target ? articleArn(principal.accountOwnerId, target.id) : undefined;
};

/** A reorder never degrades to one resource or an account wildcard. */
export const articleReorderResourceResolver: BatchResourceResolver = async ({ request, principal }) => {
  const parsed = reorderArticlesBodySchema.safeParse(request.body);
  if (!parsed.success) return undefined;
  const targets = await ArticleManagementRepository.getInstance().findTargets(
    parsed.data.items.map((item) => item.id),
    principal.accountOwnerId,
  );
  return targets?.map((target) => articleArn(principal.accountOwnerId, target.id));
};

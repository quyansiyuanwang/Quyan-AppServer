import type { ResourceResolver } from "./resource-resolvers";
import { articleArn, isCanonicalArticleId } from "../resources/article-resources";
import { ArticlePublicationRepository } from "@/store/content/article-publication.repository";
/** Account identity comes exclusively from authentication; stored author ownership is checked first. */
export const articleResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const id = request.params.id;
  if (!isCanonicalArticleId(id)) return undefined;
  const target = await ArticlePublicationRepository.getInstance().findTarget(id, principal.accountOwnerId);
  return target ? articleArn(principal.accountOwnerId, target.id) : undefined;
};

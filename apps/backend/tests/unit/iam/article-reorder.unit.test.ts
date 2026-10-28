import { describe, expect, it, vi } from "vitest";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { normalizeArticleReorder } from "@/services/article/article-validation";
import { reorderArticlesBodySchema } from "@/api/schema/article/article.schema";
import { articleReorderResourceResolver } from "@/iam/request/article-resource-resolvers";
import { ArticleManagementRepository } from "@/store/content/article-management.repository";
import type { TypedRequest } from "@/types/express";
vi.mock("@/store/content/article-management.repository", () => ({
  ArticleManagementRepository: { getInstance: vi.fn() },
}));
const principal = {
  subjectUserId: "actor",
  principalUserId: "actor",
  accountOwnerId: "owner",
  subjectType: "sub_user" as const,
};
describe("article reorder input contract", () => {
  it("normalizes only identifiers and sort order while preserving requested order", () => {
    expect(
      normalizeArticleReorder([
        { id: " article-2 ", sortOrder: "2", authorId: "foreign" },
        { id: "article-1", sortOrder: 0 },
      ]),
    ).toEqual([
      { id: "article-2", sortOrder: 2 },
      { id: "article-1", sortOrder: 0 },
    ]);
  });
  it.each([
    [],
    null,
    [{ id: "article-1", sortOrder: -1 }],
    [{ id: "article-1", sortOrder: 1.5 }],
    [{ id: "article-1", sortOrder: 2_147_483_648 }],
    [{ id: "*", sortOrder: 1 }],
    [{ id: "bad/id", sortOrder: 1 }],
    [
      { id: "article-1", sortOrder: 1 },
      { id: "article-1", sortOrder: 2 },
    ],
  ])("rejects invalid or ambiguous batch %j", (input) => {
    expect(() => normalizeArticleReorder(input)).toThrow();
  });
  it("shares the IAM request capacity and reports duplicate paths precisely", () => {
    const full = Array.from({ length: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest }, (_, index) => ({
      id: "article-" + index,
      sortOrder: index,
    }));
    expect(normalizeArticleReorder(full)).toHaveLength(IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
    expect(() => normalizeArticleReorder([...full, { id: "article-extra", sortOrder: 1 }])).toThrow();
    const parsed = reorderArticlesBodySchema.safeParse({
      items: [
        { id: "article-1", sortOrder: 1 },
        { id: "article-1", sortOrder: 2 },
      ],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].path).toEqual(["items", 1, "id"]);
  });
  it("refuses invalid batches before querying targets and never substitutes a wildcard", async () => {
    const request = {
      body: {
        items: [
          { id: "article-1", sortOrder: 1 },
          { id: "article-1", sortOrder: 2 },
        ],
      },
    } as unknown as TypedRequest;
    expect(await articleReorderResourceResolver({ request, principal })).toBeUndefined();
    expect(ArticleManagementRepository.getInstance).not.toHaveBeenCalled();
  });
});

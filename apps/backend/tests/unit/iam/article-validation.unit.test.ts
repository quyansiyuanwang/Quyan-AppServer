import { describe, expect, it } from "vitest";
import { assertArticlePublicAccess, normalizeArticleUpdate } from "@/services/article/article-validation";
import { Permission, actionForPermission, getIamActionDefinition } from "@quyan/shared";

describe("article edit validation", () => {
  it("strips fields outside the edit contract and retains normalized editable fields", () => {
    const parsed = normalizeArticleUpdate({
      title: "  Fixture  ",
      slug: " fixture-slug ",
      content: "",
      isPublic: false,
      requirePermission: "",
      authorId: "forged",
      status: -1,
      publishStatus: "published",
      publishedAt: "2026-10-09",
      isDefault: true,
      sortOrder: 100,
      viewCount: 100,
      updateTime: new Date(),
    });
    expect(parsed).toEqual({
      title: "Fixture",
      slug: "fixture-slug",
      content: "",
      isPublic: false,
      requirePermission: "",
    });
  });
  it.each([
    null,
    [],
    { title: "" },
    { slug: "../foreign" },
    { isPublic: "true" },
    { requirePermission: "x".repeat(101) },
  ])("rejects malformed edits without returning raw values", (input) => {
    expect(() => normalizeArticleUpdate(input)).toThrow();
    try {
      normalizeArticleUpdate(input);
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 400 });
    }
  });
  it("preserves public/private restriction semantics including explicitly cleared requirements", () => {
    expect(() => assertArticlePublicAccess(true, Permission.ARTICLE_READ)).toThrow();
    expect(() => assertArticlePublicAccess(true, " ")).not.toThrow();
    expect(() => assertArticlePublicAccess(true, "")).not.toThrow();
    expect(() => assertArticlePublicAccess(false, Permission.ARTICLE_READ)).not.toThrow();
  });
  it.each([Permission.ARTICLE_UPDATE, Permission.ARTICLE_DELETE])(
    "marks %s as a sensitive native article write",
    (permission) => {
      expect(getIamActionDefinition(actionForPermission(permission))).toMatchObject({
        sensitive: true,
        accessLevel: "Write",
        resourceTypes: ["quyan/account", "article/article"],
      });
    },
  );
});

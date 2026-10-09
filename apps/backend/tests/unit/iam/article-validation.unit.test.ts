import { describe, expect, it } from "vitest";
import {
  assertArticlePublicAccess,
  normalizeArticleCreate,
  normalizeArticleListFilters,
  normalizeArticleUpdate,
} from "@/services/article/article-validation";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
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

describe("article creation validation", () => {
  const input = { title: "  Creation fixture  ", slug: " creation-fixture ", content: "Fixture body" };
  it("normalizes creation fields and removes lifecycle, ownership and account overrides", () => {
    expect(
      normalizeArticleCreate({
        ...input,
        authorId: "forged",
        accountId: "foreign",
        status: -1,
        publishStatus: "published",
        publishedAt: new Date(),
        isDefault: true,
        sortOrder: 99,
        viewCount: 99,
        id: "forged",
        createTime: new Date(),
      }),
    ).toEqual({ title: "Creation fixture", slug: "creation-fixture", content: "Fixture body" });
  });
  it.each([
    null,
    [],
    {},
    { ...input, title: " " },
    { ...input, slug: "../foreign" },
    { ...input, content: "" },
    { ...input, isPublic: "true" },
    { ...input, category: "x".repeat(101) },
    { ...input, summary: "x".repeat(501) },
    { ...input, requirePermission: "x".repeat(101) },
  ])("rejects malformed create input with a localized validation error", (value) => {
    expect(() => normalizeArticleCreate(value)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
  it("declares a sensitive parent-account capability, without an unavailable article-owner condition", () => {
    const definition = getIamActionDefinition(actionForPermission(Permission.ARTICLE_CREATE))!;
    expect(definition).toMatchObject({
      action: "quyan:article:Create",
      accessLevel: "Write",
      sensitive: true,
      authorizationStage: "declared",
      resourceTypes: ["quyan/account"],
    });
    expect(definition.conditionKeys).not.toContain("quyan:ResourceOwnerId");
  });
  it("rejects a Create policy scoped only to a future article or its owner", () => {
    const statement = { Effect: "Allow", Action: "quyan:article:Create", Resource: "acs:quyan:*:account-id:account" };
    expect(() => parseIamPolicy({ Version: "1", Statement: statement })).not.toThrow();
    expect(() =>
      parseIamPolicy({
        Version: "1",
        Statement: {
          ...statement,
          Resource: "acs:article:*:account-id:article/article-id",
        },
      }),
    ).toThrow();
    expect(() =>
      parseIamPolicy({
        Version: "1",
        Statement: {
          ...statement,
          Condition: { StringEquals: { "quyan:ResourceOwnerId": "actor-id" } },
        },
      }),
    ).toThrow();
  });
});

describe("article management list filters", () => {
  it("accepts only validated filters and ignores client account or lifecycle overrides", () => {
    expect(
      normalizeArticleListFilters({
        category: "fixture",
        authorId: "author-id",
        accountId: "foreign",
        status: -1,
        publishStatus: "unknown",
      }),
    ).toEqual({ category: "fixture", authorId: "author-id" });
    expect(normalizeArticleListFilters()).toEqual({});
  });
  it.each([null, [], { category: "x".repeat(101) }, { authorId: "../foreign" }])(
    "rejects malformed filters",
    (value) => {
      expect(() => normalizeArticleListFilters(value)).toThrow(expect.objectContaining({ statusCode: 400 }));
    },
  );
});

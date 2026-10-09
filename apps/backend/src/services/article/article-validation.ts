import type { CreateArticleDto, ReorderArticleItem, UpdateArticleDto } from "@/api/dto/article/article.dto";
import {
  createArticleBodySchema,
  reorderArticlesBodySchema,
  updateArticleBodySchema,
} from "@/api/schema/article/article.schema";
import { BadRequestError } from "@/util/errors";
/** Public access and a nonempty permission requirement cannot coexist, regardless of the authorization model. */
export function assertArticlePublicAccess(isPublic: boolean, requirePermission?: string): void {
  if (isPublic && requirePermission?.trim())
    throw new BadRequestError("Public articles cannot require permissions", undefined, {
      messageKey: "article.publicCannotRequirePermissions",
    });
}
/** Creation never accepts caller-supplied publication, identity, default state or counters. */
export function normalizeArticleCreate(input: unknown): CreateArticleDto {
  const parsed = createArticleBodySchema.safeParse(input);
  if (!parsed.success)
    throw new BadRequestError("Invalid article creation", undefined, { messageKey: "errors.validationFailed" });
  return parsed.data;
}

/** Reuse HTTP validation for internal calls and strip fields outside the edit contract before persistence/audit. */
export function normalizeArticleUpdate(input: unknown): UpdateArticleDto {
  const parsed = updateArticleBodySchema.safeParse(input);
  if (!parsed.success)
    throw new BadRequestError("Invalid article edit", undefined, { messageKey: "errors.validationFailed" });
  return parsed.data;
}

/** Batch limits and duplicate semantics are shared with HTTP and resource resolution. */
export function normalizeArticleReorder(input: unknown): ReorderArticleItem[] {
  const parsed = reorderArticlesBodySchema.safeParse({ items: input });
  if (!parsed.success)
    throw new BadRequestError("Invalid article reorder", undefined, { messageKey: "errors.validationFailed" });
  return parsed.data.items;
}

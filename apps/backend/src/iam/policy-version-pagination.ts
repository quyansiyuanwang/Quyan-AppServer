import { z } from "zod";

export const IAM_VERSION_PAGINATION = Object.freeze({ defaultPageSize: 20, maxPageSize: 100 });
export const iamVersionPaginationSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(IAM_VERSION_PAGINATION.maxPageSize)
      .default(IAM_VERSION_PAGINATION.defaultPageSize),
  })
  .strict();
export type IamVersionPagination = z.infer<typeof iamVersionPaginationSchema>;

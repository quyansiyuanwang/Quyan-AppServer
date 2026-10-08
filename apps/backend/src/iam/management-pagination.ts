import { z } from "zod";
/** Apply before IAM row filtering; never expose an unfiltered account-wide total. */
export const IAM_MANAGEMENT_PAGINATION = Object.freeze({ defaultPageSize: 50, maxPageSize: 100 });
export const iamManagementPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(IAM_MANAGEMENT_PAGINATION.maxPageSize)
    .default(IAM_MANAGEMENT_PAGINATION.defaultPageSize),
});
export type IamManagementPage = z.infer<typeof iamManagementPaginationSchema>;

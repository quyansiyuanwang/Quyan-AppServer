import { IAM_MANAGEMENT_PAGINATION } from "@quyan/shared";
export { IAM_MANAGEMENT_PAGINATION } from "@quyan/shared";
import { z } from "zod";
/** Apply before IAM row filtering; never expose an unfiltered account-wide total. */
export const iamManagementPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(IAM_MANAGEMENT_PAGINATION.maxPage).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(IAM_MANAGEMENT_PAGINATION.maxPageSize)
    .default(IAM_MANAGEMENT_PAGINATION.defaultPageSize),
});
export type IamManagementPage = z.infer<typeof iamManagementPaginationSchema>;

import { isValidIamResource } from "@quyan/shared";

export const IAM_AUTHORIZATION_LIMITS = Object.freeze({ resourcesPerRequest: 500 });
export function isSafeIamResourceBatch(resources: unknown): resources is readonly string[] {
  return (
    Array.isArray(resources) &&
    resources.length > 0 &&
    resources.length <= IAM_AUTHORIZATION_LIMITS.resourcesPerRequest &&
    Array.from(resources).every((resource) => typeof resource === "string" && isValidIamResource(resource))
  );
}

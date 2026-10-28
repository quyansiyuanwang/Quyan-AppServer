import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";

export const SCRIPT_EXECUTION_LIMITS = Object.freeze({
  responseRecords: 50,
  // Each history row can require its own ARN and the linked script ARN.
  metadataBatch: Math.floor(IAM_AUTHORIZATION_LIMITS.resourcesPerRequest / 2),
});

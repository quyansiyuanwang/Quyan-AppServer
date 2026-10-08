import { IAM_POLICY_DRAFT_INPUT_LIMITS } from "@quyan/shared";
/** Internal drafting capacities; no model-generated content can adjust these limits. */
export const IAM_POLICY_DRAFT_LIMITS = Object.freeze({
  ...IAM_POLICY_DRAFT_INPUT_LIMITS,
  outputCharacters: 65536,
  explanationItems: 20,
  explanationCharacters: 500,
  requestsPerWindow: 10,
  windowSeconds: 600,
  timeoutMs: 120000,
});

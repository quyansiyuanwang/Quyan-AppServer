import type { ContentSafetyRuleInput } from "@quyan/shared";
/** High-confidence complete PEM material only. Normal tool/code/prompt syntax is allowed. */
const privateKeyLabels = [
  "PRIVATE KEY",
  "OPENSSH PRIVATE KEY",
  "RSA PRIVATE KEY",
  "EC PRIVATE KEY",
  "DSA PRIVATE KEY",
  "ENCRYPTED PRIVATE KEY",
  "PGP PRIVATE KEY",
];
const encodedBody = String.raw`(?:[A-Za-z0-9+/=](?:\\[rn]|\s){0,4}){128,8192}`;
export const FULL_PRIVATE_KEY_PATTERN = privateKeyLabels
  .map((label) => `-----BEGIN ${label}-----(?:[\\s]|\\\\[rn])*${encodedBody}-----END ${label}-----`)
  .join("|");
// Used only by the explicit administrator import action; existing database rules are untouched.
export const DEFAULT_CONTENT_SAFETY_RULES: ContentSafetyRuleInput[] = [
  {
    name: "Private key material",
    type: "regex",
    pattern: FULL_PRIVATE_KEY_PATTERN,
    direction: "both",
    action: "unreachable",
  },
];

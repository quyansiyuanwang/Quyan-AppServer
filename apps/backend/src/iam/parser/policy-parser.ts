import { createHash } from "node:crypto";
import type { NormalizedIamPolicyDocument } from "@quyan/shared";
import { IAM_POLICY_LIMITS, iamPolicyDocumentSchema } from "./policy-schema";
import { normalizeIamPolicy } from "./policy-normalizer";

export class IamPolicyValidationError extends Error {
  constructor() {
    super("Invalid IAM policy document");
    this.name = "IamPolicyValidationError";
  }
}
/** Inspect before stringify: reject cycles, prototype keys, accessors and unbounded object graphs. */
function assertJson(value: unknown): void {
  const seen = new Set<object>();
  let nodes = 0;
  const visit = (current: unknown, depth: number): void => {
    if (++nodes > IAM_POLICY_LIMITS.nodes || depth > IAM_POLICY_LIMITS.depth) throw new IamPolicyValidationError();
    if (current === null || typeof current === "boolean") return;
    if (typeof current === "string") {
      if (Buffer.byteLength(current) > IAM_POLICY_LIMITS.bytes) throw new IamPolicyValidationError();
      return;
    }
    if (typeof current === "number" && Number.isFinite(current)) return;
    if (typeof current !== "object" || seen.has(current)) throw new IamPolicyValidationError();
    if (
      !Array.isArray(current) &&
      Object.getPrototypeOf(current) !== Object.prototype &&
      Object.getPrototypeOf(current) !== null
    )
      throw new IamPolicyValidationError();
    seen.add(current);
    for (const key of Reflect.ownKeys(current)) {
      if (Array.isArray(current) && key === "length") continue;
      if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key))
        throw new IamPolicyValidationError();
      const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
      if (!("value" in descriptor) || !descriptor.enumerable) throw new IamPolicyValidationError();
      visit(descriptor.value, depth + 1);
    }
    seen.delete(current);
  };
  visit(value, 0);
}
export interface ParsedIamPolicy {
  document: NormalizedIamPolicyDocument;
  canonicalJson: string;
  documentHash: string;
}
export function parseIamPolicy(input: unknown): ParsedIamPolicy {
  if (typeof input === "string") {
    if (Buffer.byteLength(input) > IAM_POLICY_LIMITS.bytes) throw new IamPolicyValidationError();
    try {
      input = JSON.parse(input);
    } catch {
      throw new IamPolicyValidationError();
    }
  }
  assertJson(input);
  const serialized = JSON.stringify(input);
  if (!serialized || Buffer.byteLength(serialized) > IAM_POLICY_LIMITS.bytes) throw new IamPolicyValidationError();
  const parsed = iamPolicyDocumentSchema.safeParse(input);
  if (!parsed.success) throw new IamPolicyValidationError();
  const document = normalizeIamPolicy(parsed.data);
  const canonicalJson = JSON.stringify(document);
  return { document, canonicalJson, documentHash: createHash("sha256").update(canonicalJson).digest("hex") };
}

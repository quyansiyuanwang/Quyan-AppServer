import { parseIamTrustPolicy, iamTrustPolicyDocumentSchema, iamPrincipalSelectorSchema } from "../trust/trust-policy";
import type { IamDiagnostic, IamDiagnosticCode, IamPolicyDiagnosis } from "@quyan/shared";
import {
  IAM_ACTION_DEFINITIONS,
  IAM_RESOURCE_TYPE_CATALOG,
  isIamPolicyResourceInAccount,
  resolveIamStatementActions,
} from "@quyan/shared";
import type { ZodIssue } from "zod";
import { findNodeAtLocation } from "jsonc-parser";
import { iamPolicyDocumentSchema } from "../parser/policy-schema";
import { parseIamPolicy, IamPolicyValidationError } from "../parser/policy-parser";
import { matchIamPattern } from "../evaluator/wildcard-matcher";
import { inspectPolicyJson, sourceDiagnostic, IAM_DIAGNOSTIC_LIMIT } from "./source-json";
function issues(input: readonly ZodIssue[]): ZodIssue[] {
  return input.flatMap((issue) => {
    if (issue.code !== "invalid_union") return [issue];
    // Select the branch with meaningful validation failures rather than wrong-container errors.
    const branches = issue.unionErrors.map((error) => issues(error.issues));
    return branches.sort(
      (a, b) =>
        a.reduce((n, i) => n + (i.code === "invalid_type" ? 100 : 1), 0) -
        b.reduce((n, i) => n + (i.code === "invalid_type" ? 100 : 1), 0),
    )[0];
  });
}
const codeForIssue = (issue: ZodIssue): IamDiagnosticCode =>
  issue.path[0] === "Version"
    ? "invalid-version"
    : issue.message === "Unknown platform action"
      ? "unknown-action"
      : issue.message === "Unreachable Deny resource type"
        ? "unreachable-deny"
        : issue.message === "Action and resource types are incompatible"
          ? "resource-type-mismatch"
          : issue.message === "Invalid ACS resource pattern" || issue.message === "Unregistered platform resource"
            ? "invalid-resource"
            : issue.path.includes("Principal")
              ? "invalid-principal"
              : issue.path.includes("Condition")
                ? "invalid-condition"
                : "invalid-field";
/** Pure diagnosis. Neither persistence nor delegation is performed here. */
export function diagnoseIamPolicy(
  text: string,
  accountOwnerId?: string,
  policyKind: "identity" | "trust" = "identity",
): IamPolicyDiagnosis {
  const source = inspectPolicyJson(text);
  const diagnostics = [...source.diagnostics];
  const add = (code: IamDiagnosticCode, parts: (string | number)[], severity: IamDiagnostic["severity"] = "error") => {
    if (diagnostics.length < IAM_DIAGNOSTIC_LIMIT)
      diagnostics.push(sourceDiagnostic(text, code, parts, severity, source.tree));
  };
  const finish = (
    parsed?: ReturnType<typeof parseIamPolicy> | ReturnType<typeof parseIamTrustPolicy>,
  ): IamPolicyDiagnosis => {
    const valid = !diagnostics.some((diagnostic) => diagnostic.severity === "error");
    return {
      valid,
      diagnostics,
      riskLevel: diagnostics.some((d) => d.severity === "error" || d.severity === "security-warning")
        ? "high"
        : diagnostics.some((d) => d.severity === "warning")
          ? "medium"
          : "low",
      delegation: "not-evaluated",
      ...(valid && parsed ? { document: parsed.document, documentHash: parsed.documentHash } : {}),
    };
  };
  if (diagnostics.length) return finish();
  if (policyKind === "identity" && source.input && typeof source.input === "object") {
    const raw = (source.input as { Statement?: unknown }).Statement;
    const statements = Array.isArray(raw) ? raw : [raw];
    statements.forEach((statement, index) => {
      if (!statement || typeof statement !== "object" || Array.isArray(statement)) return;
      const hasAction = Object.hasOwn(statement, "Action"),
        hasNotAction = Object.hasOwn(statement, "NotAction");
      if (hasAction === hasNotAction)
        add("invalid-action-selector", [
          ...(Array.isArray(raw) ? ["Statement", index] : ["Statement"]),
          hasNotAction ? "NotAction" : "Action",
        ]);
    });
    if (diagnostics.length) return finish();
  }
  const schema = policyKind === "trust" ? iamTrustPolicyDocumentSchema : iamPolicyDocumentSchema;
  const result = schema.safeParse(source.input);
  if (!result.success) {
    for (const issue of issues(result.error.issues)) {
      if (issue.code === "unrecognized_keys") {
        for (const key of issue.keys) add("unknown-field", [...issue.path, key]);
      } else add(codeForIssue(issue), issue.path);
    }
    return finish();
  }
  let parsed: ReturnType<typeof parseIamPolicy> | ReturnType<typeof parseIamTrustPolicy>;
  try {
    parsed = policyKind === "trust" ? parseIamTrustPolicy(source.input) : parseIamPolicy(source.input);
  } catch (error) {
    add(
      error instanceof IamPolicyValidationError && error.reason === "document-limit"
        ? "document-limit"
        : "invalid-field",
      [],
    );
    return finish();
  }
  const statements = Array.isArray(result.data.Statement) ? result.data.Statement : [result.data.Statement];
  const arrayStatement = Array.isArray(result.data.Statement);
  const seen = new Set<string>();
  statements.forEach((statement, index) => {
    const base: (string | number)[] = arrayStatement ? ["Statement", index] : ["Statement"];
    const actions = resolveIamStatementActions(statement),
      resources = [statement.Resource].flat();
    const expanded = IAM_ACTION_DEFINITIONS.filter((action) =>
      actions.some((pattern) => matchIamPattern(pattern, action.action)),
    );
    const selector = "NotAction" in statement ? "NotAction" : "Action";
    if (selector === "NotAction")
      add("not-action-snapshot", [...base, selector], statement.Effect === "Allow" ? "security-warning" : "warning");
    if (statement.Effect === "Allow") {
      if (actions.some((action) => action.includes("*"))) add("broad-action", [...base, "Action"], "security-warning");
      if (resources.some((resource) => resource === "*" || resource.includes("*:*:")))
        add("broad-resource", [...base, "Resource"], "security-warning");
      if (expanded.some((action) => action.sensitive && action.service === "ram" && action.accessLevel === "Write"))
        add("iam-management", [...base, selector], "security-warning");
    }
    if ("Principal" in statement) {
      const principals = iamPrincipalSelectorSchema.parse(statement.Principal).RAM;
      [principals].flat().forEach((principal, principalIndex) => {
        if (accountOwnerId && principal.split(":")[3] !== accountOwnerId)
          add(
            "cross-account-principal",
            Array.isArray(principals) ? [...base, "Principal", "RAM", principalIndex] : [...base, "Principal", "RAM"],
          );
      });
    }
    const canonical = (policyKind === "trust" ? parseIamTrustPolicy : parseIamPolicy)({
      Version: "1",
      Statement: statement,
    }).canonicalJson;
    if (seen.has(canonical)) add("duplicate-statement", base, "suggestion");
    seen.add(canonical);
    resources.forEach((resource, resourceIndex) => {
      if (resource === "*") return;
      const parts = resource.split(":"),
        service = parts[1],
        owner = parts[3],
        resourcePath = parts[4];
      const location = Array.isArray(statement.Resource) ? [...base, "Resource", resourceIndex] : [...base, "Resource"];
      if (accountOwnerId && owner && !isIamPolicyResourceInAccount(resource, accountOwnerId))
        add("cross-account-resource", location);
      const types = IAM_RESOURCE_TYPE_CATALOG.filter(
        (type) => matchIamPattern(service, type.service) && matchIamPattern(resourcePath.split("/")[0], type.type),
      );
      if (!types.length || !expanded.some((action) => types.some((type) => action.resourceTypes.includes(type.id))))
        add(statement.Effect === "Deny" ? "unreachable-deny" : "resource-type-mismatch", location, "warning");
    });
  });
  // Ensure source pointers remain attached to the user's original, unsorted document.
  if (!findNodeAtLocation(source.tree!, ["Statement"])) add("invalid-field", ["Statement"]);
  return finish(parsed);
}

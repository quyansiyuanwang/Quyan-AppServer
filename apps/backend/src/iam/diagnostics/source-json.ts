import { createScanner, findNodeAtLocation, getNodePath, parseTree, SyntaxKind } from "jsonc-parser";
import type { Node, ParseError } from "jsonc-parser";
import type { IamDiagnostic, IamDiagnosticCode } from "@quyan/shared";
import { IAM_POLICY_LIMITS } from "../parser/policy-schema";
export const IAM_DIAGNOSTIC_LIMIT = 100;
export const jsonPointer = (parts: readonly (string | number)[]) =>
  parts.map((part) => "/" + String(part).replace(/~/g, "~0").replaceAll("/", "~1")).join("");
export function sourceDiagnostic(
  text: string,
  code: IamDiagnosticCode,
  parts: readonly (string | number)[] = [],
  severity: IamDiagnostic["severity"] = "error",
  tree?: Node,
  offset?: number,
): IamDiagnostic {
  const node = tree && findNodeAtLocation(tree, [...parts]);
  const position = Math.min(offset ?? node?.offset ?? tree?.offset ?? 0, text.length);
  const prefix = text.slice(0, position).split(/\r\n|\r|\n/);
  return {
    severity,
    code,
    path: jsonPointer(parts),
    line: prefix.length,
    column: prefix[prefix.length - 1].length + 1,
    messageKey: "RamManagement.diagnosticMessages." + code,
  };
}
/** Strict JSON only. Scan bounds before building a recursive AST. */
export function inspectPolicyJson(text: string): { tree?: Node; input?: unknown; diagnostics: IamDiagnostic[] } {
  if (Buffer.byteLength(text) > IAM_POLICY_LIMITS.bytes)
    return { diagnostics: [sourceDiagnostic(text, "document-limit")] };
  const scanner = createScanner(text, true);
  let depth = 0,
    nodes = 0;
  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    if (token === SyntaxKind.OpenBraceToken || token === SyntaxKind.OpenBracketToken) depth++;
    if (token === SyntaxKind.CloseBraceToken || token === SyntaxKind.CloseBracketToken) depth--;
    if (depth > IAM_POLICY_LIMITS.depth || ++nodes > IAM_POLICY_LIMITS.nodes * 5)
      return {
        diagnostics: [sourceDiagnostic(text, "document-limit", [], "error", undefined, scanner.getTokenOffset())],
      };
  }
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false });
  if (errors.length || !tree)
    return {
      tree,
      diagnostics: errors.length
        ? errors
            .slice(0, IAM_DIAGNOSTIC_LIMIT)
            .map((error) => sourceDiagnostic(text, "json-syntax", [], "error", tree, error.offset))
        : [sourceDiagnostic(text, "json-syntax")],
    };
  const diagnostics: IamDiagnostic[] = [];
  const pending = [tree];
  while (pending.length && diagnostics.length < IAM_DIAGNOSTIC_LIMIT) {
    const node = pending.pop()!;
    if (node.type === "object") {
      const keys = new Set<string>();
      for (const property of node.children ?? []) {
        const key = property.children![0];
        const parts = [...getNodePath(node), key.value as string];
        if (["__proto__", "prototype", "constructor"].includes(key.value))
          diagnostics.push(sourceDiagnostic(text, "unsafe-key", parts, "error", tree, key.offset));
        if (keys.has(key.value))
          diagnostics.push(sourceDiagnostic(text, "duplicate-key", parts, "error", tree, key.offset));
        keys.add(key.value);
      }
    }
    pending.push(...(node.children ?? []));
  }
  if (diagnostics.length) return { tree, diagnostics: diagnostics.slice(0, IAM_DIAGNOSTIC_LIMIT) };
  try {
    return { tree, input: JSON.parse(text), diagnostics };
  } catch {
    return { tree, diagnostics: [sourceDiagnostic(text, "json-syntax")] };
  }
}

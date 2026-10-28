import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IAM_ACTION_CATALOG, isKnownIamAction } from "@quyan/shared";
import { alicloudDnsPolicyExample } from "../../fixtures/iam/alicloud-policy.examples";
import { parseIamPolicy } from "../../../src/iam/parser/policy-parser";
import { assertIamAuthorizationDefinition } from "../../../src/iam/request/authorization-definition";
describe("production and example Action separation", () => {
  it("keeps external cloud actions outside every production entry point", () => {
    expect(IAM_ACTION_CATALOG.every((action) => action.startsWith("quyan:"))).toBe(true);
    const statements = Array.isArray(alicloudDnsPolicyExample.Statement)
      ? alicloudDnsPolicyExample.Statement
      : [alicloudDnsPolicyExample.Statement];
    for (const statement of statements)
      for (const action of [statement.Action].flat()) {
        expect(isKnownIamAction(action)).toBe(false);
        expect(() =>
          assertIamAuthorizationDefinition({ action, resourceKind: "account", resource: () => "*" }),
        ).toThrow();
      }
    expect(() => parseIamPolicy(alicloudDnsPolicyExample)).toThrow();
  });
  it("keeps the published external syntax example aligned with its test fixture", () => {
    const document = JSON.parse(
      readFileSync(
        new URL("../../../../../docs/examples/iam/alicloud-compatible-policy.json", import.meta.url),
        "utf8",
      ),
    );
    expect(document).toEqual(alicloudDnsPolicyExample);
  });
});

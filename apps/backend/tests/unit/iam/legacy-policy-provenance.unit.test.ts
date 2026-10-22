import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, Permission, actionForPermission } from "@quyan/shared";
import { legacyPermissionsToPolicy } from "@/iam/legacy-policy";
import { isGeneratedLegacyPolicyDocument } from "@/iam/migration/legacy-policy-provenance";
import { parseIamPolicy } from "@/iam/parser/policy-parser";

const owner = "migration-owner";
const original = () => parseIamPolicy(legacyPermissionsToPolicy(ALL_PERMISSIONS, owner)).document;
describe("legacy policy migration provenance", () => {
  it("accepts all permission chunks after normalization without locking out migrated administrators", () => {
    const document = original();
    expect(document.Statement.length).toBeGreaterThan(1);
    expect(isGeneratedLegacyPolicyDocument(document, ALL_PERMISSIONS, owner)).toBe(true);
    expect(
      isGeneratedLegacyPolicyDocument(
        { ...document, Statement: [...document.Statement].reverse() },
        ALL_PERMISSIONS,
        owner,
      ),
    ).toBe(true);
  });
  it("still accepts older single-statement source subsets", () => {
    const permissions = [Permission.RAM_USER_READ];
    const document = parseIamPolicy(legacyPermissionsToPolicy(permissions, owner)).document;
    document.Statement[0].Action = [actionForPermission(Permission.RAM_USER_READ)];
    document.Statement[0].Resource = ["acs:quyan:*:" + owner + ":account"];
    expect(isGeneratedLegacyPolicyDocument(document, permissions, owner)).toBe(true);
  });
  it.each(["effect", "sid", "condition", "action", "resource", "missing-permission", "missing-account"])(
    "rejects tampering across any chunk: %s",
    (mutation) => {
      const document = original();
      const last = document.Statement[document.Statement.length - 1];
      if (mutation === "effect") last.Effect = "Deny";
      if (mutation === "sid") last.Sid = "not-generated";
      if (mutation === "condition") last.Condition = { Bool: { "acs:SecureTransport": true } };
      if (mutation === "action") last.Action.push("*");
      if (mutation === "resource") last.Resource.push("*");
      if (mutation === "missing-permission")
        for (const statement of document.Statement)
          statement.Action = statement.Action.filter(
            (action) => action !== actionForPermission(Permission.RAM_USER_READ),
          );
      if (mutation === "missing-account")
        for (const statement of document.Statement)
          statement.Resource = statement.Resource.filter((resource) => !resource.endsWith(":account"));
      expect(isGeneratedLegacyPolicyDocument(document, ALL_PERMISSIONS, owner)).toBe(false);
    },
  );
});

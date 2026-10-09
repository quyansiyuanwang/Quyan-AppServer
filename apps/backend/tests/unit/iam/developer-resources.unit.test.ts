import { describe, expect, it } from "vitest";
import { getIamActionDefinition, getIamResourceType, isIamActionResourceCompatible } from "@quyan/shared";
import {
  developerProjectArn,
  developerKvArn,
  developerSecretArn,
  developerKvKeyFromArnSegment,
} from "@/iam/resources/developer-resources";
import {
  developerKvResourceResolver,
  developerSecretResourceResolver,
} from "@/iam/request/developer-resource-resolvers";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
const principal = {
  subjectUserId: "actor",
  principalUserId: "actor",
  accountOwnerId: "owner",
  subjectType: "sub_user" as const,
};
describe("developer item resource identities", () => {
  it("encodes distinct valid keys reversibly without ARN delimiters, wildcards or padding", () => {
    const keys = ["page", "config:prod.v1", "config-prod_v1", ".", "..", "A".repeat(191)];
    const arns = keys.map((key) => developerKvArn("owner", "project-1", key));
    expect(new Set(arns).size).toBe(keys.length);
    arns.forEach((arn, index) => {
      const segment = arn.split("/").at(-1)!;
      expect(segment).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(developerKvKeyFromArnSegment(segment)).toBe(keys[index]);
      expect(arn.length).toBeLessThanOrEqual(512);
      expect(getIamResourceType(arn)?.id).toBe("developer/kv-item");
    });
  });
  it.each(["*", "", "bad/key", "bad?key", " config ", "é", "a".repeat(192), "a\n"])(
    "rejects unsafe or noncanonical key %j",
    (key) => {
      expect(() => developerKvArn("owner", "project", key)).toThrow();
    },
  );
  it("rejects alternate base64 encodings and invalid decoded keys", () => {
    for (const segment of ["", "YQ==", "YQ=", "YR", "Ki", "Kg", "L2E", "YWJj!", "_w"])
      expect(developerKvKeyFromArnSegment(segment)).toBeUndefined();
    expect(developerKvKeyFromArnSegment("YQ")).toBe("a");
  });
  it("keeps secret aliases exact and uses only the authenticated account", async () => {
    const request = {
      params: { projectId: "project" },
      body: { alias: "API_KEY", accountOwnerId: "foreign" },
      headers: { "x-action": "*" },
    } as never;
    expect(await developerSecretResourceResolver({ principal, request })).toBe(
      "acs:developer:*:owner:secret/project/API_KEY",
    );
    expect(
      await developerKvResourceResolver({
        principal,
        request: { params: { projectId: "project", key: "page" }, body: { accountId: "foreign" } } as never,
      }),
    ).toBe(developerKvArn("owner", "project", "page"));
    for (const alias of ["api_key", "*", "../API_KEY", " API_KEY ", ""])
      expect(
        await developerSecretResourceResolver({
          principal,
          request: { params: { projectId: "project", alias }, body: { alias: "API_KEY" } } as never,
        }),
      ).toBeUndefined();
  });
  it("rejects invalid project/account identifiers and missing resolver data", async () => {
    for (const project of ["*", "bad/id", " project "])
      expect(() => developerSecretArn("owner", project, "API_KEY")).toThrow();
    expect(() => developerKvArn("*", "project", "key")).toThrow();
    expect(
      await developerKvResourceResolver({ principal, request: { params: { projectId: "project" } } as never }),
    ).toBeUndefined();
  });
  it("requires the item type for reads and writes; project list permission does not cover children", () => {
    const project = developerProjectArn("owner", "project");
    const kv = developerKvArn("owner", "project", "key");
    const secret = developerSecretArn("owner", "project", "API_KEY");
    for (const action of ["GetKv", "SetKv", "DeleteKv"]) {
      expect(isIamActionResourceCompatible("quyan:developer:" + action, kv)).toBe(true);
      expect(isIamActionResourceCompatible("quyan:developer:" + action, project)).toBe(false);
      expect(isIamActionResourceCompatible("quyan:developer:" + action, secret)).toBe(false);
    }
    for (const action of ["PutSecret", "DeleteSecret"])
      expect(getIamActionDefinition("quyan:developer:" + action)?.resourceTypes).toEqual(["developer/secret"]);
    const document = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:developer:ListKv", Resource: project },
    }).document;
    expect(
      evaluatePolicies([{ policyId: "fixture", document }], { action: "quyan:developer:ListKv", resource: kv })
        .decision,
    ).toBe("ImplicitDeny");
    expect(() =>
      parseIamPolicy({
        Version: "1",
        Statement: { Effect: "Allow", Action: "quyan:developer:GetKv", Resource: project },
      }),
    ).toThrow();
  });
});

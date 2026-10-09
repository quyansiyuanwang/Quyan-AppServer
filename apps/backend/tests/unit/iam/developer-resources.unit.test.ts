import { describe, expect, it } from "vitest";
import { getIamActionDefinition, getIamResourceType, isIamActionResourceCompatible } from "@quyan/shared";
import {
  developerProjectArn,
  developerKvArn,
  developerSecretArn,
  developerShortLinkArn,
  developerProjectApiKeyArn,
  developerStatusMonitorArn,
  developerPushChannelArn,
  developerKvKeyFromArnSegment,
} from "@/iam/resources/developer-resources";
import {
  developerKvResourceResolver,
  developerSecretResourceResolver,
  developerShortLinkResourceResolver,
  developerProjectApiKeyResourceResolver,
  developerStatusMonitorResourceResolver,
  developerPushChannelResourceResolver,
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
  it("targets the stored short-link ID under the exact project and keeps statistics separate", async () => {
    const arn = developerShortLinkArn("owner", "project", "link-1");
    expect(arn).toBe("acs:developer:*:owner:short-link/project/link-1");
    expect(
      await developerShortLinkResourceResolver({
        principal,
        request: {
          params: { projectId: "project", id: "link-1" },
          body: { code: "public-code", accountId: "foreign" },
        } as never,
      }),
    ).toBe(arn);
    for (const id of ["*", "bad/id", " link-1 ", undefined])
      expect(
        await developerShortLinkResourceResolver({
          principal,
          request: { params: { projectId: "project", id } } as never,
        }),
      ).toBeUndefined();
    expect(getIamActionDefinition("quyan:developer:GetShortLinkStats")).toMatchObject({
      accessLevel: "Read",
      sensitive: true,
      resourceTypes: ["developer/short-link"],
    });
    expect(isIamActionResourceCompatible("quyan:developer:CreateShortLink", arn)).toBe(false);
    expect(
      isIamActionResourceCompatible("quyan:developer:CreateShortLink", developerProjectArn("owner", "project")),
    ).toBe(true);
    const document = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:developer:ListShortLinks", Resource: arn },
    }).document;
    expect(
      evaluatePolicies([{ policyId: "fixture", document }], {
        action: "quyan:developer:GetShortLinkStats",
        resource: arn,
      }).decision,
    ).toBe("ImplicitDeny");
  });
  it("uses the credential record ID rather than key material and isolates revoke from metadata list", async () => {
    const arn = developerProjectApiKeyArn("owner", "project", "credential-1");
    expect(arn).toBe("acs:developer:*:owner:project-api-key/project/credential-1");
    expect(
      await developerProjectApiKeyResourceResolver({
        principal,
        request: {
          params: { projectId: "project", id: "credential-1" },
          body: { key: "fixture-ignored", accountId: "foreign" },
        } as never,
      }),
    ).toBe(arn);
    expect(
      await developerProjectApiKeyResourceResolver({
        principal,
        request: { params: { projectId: "project", id: "*" } } as never,
      }),
    ).toBeUndefined();
    expect(getIamActionDefinition("quyan:developer:ListProjectApiKeys")?.sensitive).toBe(true);
    expect(getIamActionDefinition("quyan:developer:RevokeProjectApiKey")?.resourceTypes).toEqual([
      "developer/project-api-key",
    ]);
    const document = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:developer:ListProjectApiKeys", Resource: arn },
    }).document;
    expect(
      evaluatePolicies([{ policyId: "fixture", document }], {
        action: "quyan:developer:RevokeProjectApiKey",
        resource: arn,
      }).decision,
    ).toBe("ImplicitDeny");
  });
  it("uses concrete channel resources without implicit Secret-use authority", async () => {
    const arn = developerPushChannelArn("owner", "project", "channel-1");
    expect(arn).toBe("acs:developer:*:owner:push-channel/project/channel-1");
    expect(
      await developerPushChannelResourceResolver({
        principal,
        request: { params: { projectId: "project", id: "channel-1" }, body: { accountId: "foreign" } } as never,
      }),
    ).toBe(arn);
    for (const id of ["*", "bad/id", " channel-1 ", undefined])
      expect(
        await developerPushChannelResourceResolver({
          principal,
          request: { params: { projectId: "project", id } } as never,
        }),
      ).toBeUndefined();
    expect(isIamActionResourceCompatible("quyan:developer:CreatePushChannel", arn)).toBe(false);
    expect(
      isIamActionResourceCompatible("quyan:developer:CreatePushChannel", developerProjectArn("owner", "project")),
    ).toBe(true);
    expect(isIamActionResourceCompatible("quyan:developer:UseSecret", arn)).toBe(false);
    expect(getIamActionDefinition("quyan:developer:UseSecret")).toMatchObject({
      sensitive: true,
      resourceTypes: ["developer/secret"],
    });
    expect(getIamActionDefinition("quyan:developer:ListPushChannels")?.sensitive).toBe(true);
    const document = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:developer:UpdatePushChannel", Resource: arn },
    }).document;
    expect(
      evaluatePolicies([{ policyId: "fixture", document }], {
        action: "quyan:developer:UseSecret",
        resource: developerSecretArn("owner", "project", "TOKEN"),
      }).decision,
    ).toBe("ImplicitDeny");
  });
  it("isolates monitor create, list, mutation and outbound check capabilities", async () => {
    const arn = developerStatusMonitorArn("owner", "project", "monitor-1");
    expect(arn).toBe("acs:developer:*:owner:status-monitor/project/monitor-1");
    expect(
      await developerStatusMonitorResourceResolver({
        principal,
        request: {
          params: { projectId: "project", id: "monitor-1" },
          body: { accountId: "foreign", targetUrl: "https://example.com/fixture" },
        } as never,
      }),
    ).toBe(arn);
    for (const id of ["*", "bad/id", " monitor-1 ", undefined])
      expect(
        await developerStatusMonitorResourceResolver({
          principal,
          request: { params: { projectId: "project", id } } as never,
        }),
      ).toBeUndefined();
    expect(isIamActionResourceCompatible("quyan:developer:CreateStatusMonitor", arn)).toBe(false);
    expect(
      isIamActionResourceCompatible("quyan:developer:CreateStatusMonitor", developerProjectArn("owner", "project")),
    ).toBe(true);
    for (const action of ["UpdateStatusMonitor", "DeleteStatusMonitor", "CheckStatusMonitor"])
      expect(getIamActionDefinition("quyan:developer:" + action)).toMatchObject({
        accessLevel: "Write",
        sensitive: true,
        resourceTypes: ["developer/status-monitor"],
      });
    const document = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:developer:ListStatusMonitors", Resource: arn },
    }).document;
    expect(
      evaluatePolicies([{ policyId: "fixture", document }], {
        action: "quyan:developer:CheckStatusMonitor",
        resource: arn,
      }).decision,
    ).toBe("ImplicitDeny");
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

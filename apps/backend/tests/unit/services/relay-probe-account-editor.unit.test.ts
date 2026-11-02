import { describe, expect, it } from "vitest";
import {
  assertProbeAccountRevision,
  probeAccountRevision,
  projectProbeLoginForEditor,
  restoreProbeLoginFields,
} from "@/services/relay/relay-probe-account-editor";
import { saveRelayChannelProbeAccountBodySchema } from "@/api/schema/relay/relay-channel-probe.schema";

const workflow = {
  method: "POST" as const,
  url: "https://panel.example.com/login?secret=fixture-secret",
  headers: { Authorization: "Bearer {{panelToken}}", "X-Secret": "fixture-header-secret" },
  body: { username: "{{username}}", password: "{{password}}", nested: { cookies: ["fixture-cookie"] }, attempts: 2 },
};
const encrypted = {
  encryptedCredentials: "fixture-ciphertext",
  credentialIv: "fixture-iv",
  credentialAuthTag: "fixture-tag",
};

describe("safe probe account editor", () => {
  it("projects variable references and masks every literal, including URL and nested body values", () => {
    const result = projectProbeLoginForEditor(workflow);
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
    expect(JSON.stringify(result)).not.toContain("fixture-header-secret");
    expect(JSON.stringify(result)).not.toContain("fixture-cookie");
    expect(result.loginWorkflow.url).toBe("");
    expect(result.loginWorkflow.headers?.Authorization).toBe("Bearer {{panelToken}}");
    expect(result.requiredCredentialNames).toEqual(["panelToken", "password", "username"]);
    expect(restoreProbeLoginFields(result.loginWorkflow, workflow, result.retainedFields)).toEqual(workflow);
    expect(result.loginWorkflow.url).toBe("");
  });
  it("does not reveal static secret text around interpolated variables", () => {
    const result = projectProbeLoginForEditor({
      ...workflow,
      headers: { Authorization: "fixture-secret {{panelToken}}" },
    });
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
    expect(result.requiredCredentialNames).toContain("panelToken");
  });
  it("binds editor writes to the encrypted configuration rather than last login time", () => {
    const revision = probeAccountRevision(encrypted);
    expect(() => assertProbeAccountRevision(revision, encrypted)).not.toThrow();
    expect(() => assertProbeAccountRevision(revision, { ...encrypted, encryptedCredentials: "changed" })).toThrow();
  });
  it.each([["method"], ["body", "__proto__", "polluted"], ["missing"], ["body", "nested"]])(
    "rejects invalid retained path %j",
    (...path) => {
      const projected = projectProbeLoginForEditor(workflow).loginWorkflow;
      expect(() => restoreProbeLoginFields(projected, workflow, [path])).toThrow();
      expect({}).not.toHaveProperty("polluted");
    },
  );
  it("requires a revision for retained fields or partial credential updates", () => {
    const base = {
      name: "fixture",
      loginWorkflow: workflow,
      tokenPath: "data.token",
      fallbackTtlSeconds: 900,
      minLoginIntervalSeconds: 300,
    };
    expect(saveRelayChannelProbeAccountBodySchema.safeParse(base).success).toBe(true);
    expect(
      saveRelayChannelProbeAccountBodySchema.safeParse({ ...base, credentialUpdates: { password: "changed" } }).success,
    ).toBe(false);
    const projected = projectProbeLoginForEditor(workflow);
    expect(
      saveRelayChannelProbeAccountBodySchema.safeParse({
        ...base,
        ...projected,
        expectedRevision: probeAccountRevision(encrypted),
      }).success,
    ).toBe(true);
  });
});

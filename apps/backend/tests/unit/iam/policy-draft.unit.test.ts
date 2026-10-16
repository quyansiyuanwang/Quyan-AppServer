import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/services/chat/chat.service", () => ({ ChatService: { getInstance: vi.fn() } }));
vi.mock("@/services/infrastructure/redis.service", () => ({ RedisService: { getInstance: vi.fn() } }));
import { generateIamPolicyDraftBodySchema } from "@/api/schema/users/ram.schema";
import { IamPolicyDraftService, diagnoseGeneratedDraft } from "@/iam/ai/policy-draft.service";
import { IAM_POLICY_DRAFT_LIMITS } from "@/iam/ai/draft-limits";
const generateTextForUser = vi.fn(),
  tryIncrementWithinLimit = vi.fn(),
  delegationCheck = vi.fn();
const service = new IamPolicyDraftService({ generateTextForUser }, { tryIncrementWithinLimit });
const document = {
  Version: "1",
  Statement: { Effect: "Allow", Action: "quyan:ram:ReadUser", Resource: "acs:quyan:*:owner:user/one" },
};
const input = { instruction: "Read user one", model: "fixture-model", relayTokenId: "fixture-token" };
beforeEach(() => {
  vi.resetAllMocks();
  tryIncrementWithinLimit.mockResolvedValue(1);
  delegationCheck.mockResolvedValue({ allowed: true, issues: [] });
});
describe("AI policy drafting admission", () => {
  it("rejects oversize requests and unsupported fields without silently truncating requirements", () => {
    for (const data of [
      { ...input, instruction: "x".repeat(IAM_POLICY_DRAFT_LIMITS.instructionCharacters + 1) },
      { ...input, currentDocumentText: "x".repeat(IAM_POLICY_DRAFT_LIMITS.inputCharacters + 1) },
      { ...input, accountOwnerId: "foreign" },
      { ...input, instruction: " " },
    ])
      expect(generateIamPolicyDraftBodySchema.safeParse(data).success).toBe(false);
  });
  it("bounds raw output and refuses invented explanation fields", () => {
    expect(
      diagnoseGeneratedDraft(" ".repeat(IAM_POLICY_DRAFT_LIMITS.outputCharacters + 1), "owner", "identity").diagnosis
        .valid,
    ).toBe(false);
    expect(
      diagnoseGeneratedDraft(
        JSON.stringify({ document, explanation: ["x".repeat(IAM_POLICY_DRAFT_LIMITS.explanationCharacters + 1)] }),
        "owner",
        "identity",
      ).diagnosis.valid,
    ).toBe(false);
  });
  it("forwards request metadata and combines disconnect cancellation with the server timeout", async () => {
    generateTextForUser.mockResolvedValue(JSON.stringify(document));
    const abort = new AbortController();
    await service.generate("child", "owner", input, delegationCheck, {
      requestId: "request-1",
      ipAddress: "192.0.2.1",
      signal: abort.signal,
    });
    const options = generateTextForUser.mock.calls[0]![4];
    expect(options).toMatchObject({
      requestId: "request-1",
      ipAddress: "192.0.2.1",
      method: "POST",
      path: "/v1/ram/policies/ai/draft",
    });
    expect(options.signal.aborted).toBe(false);
    abort.abort();
    expect(options.signal.aborted).toBe(true);
  });
  it("uses the real platform catalog and user-owned billed generation, then diagnoses and proves the draft", async () => {
    generateTextForUser.mockResolvedValue(
      JSON.stringify({ document, explanation: ["Read one user"], missingInformation: [] }),
    );
    const result = await service.generate("child", "owner", input, delegationCheck);
    expect(result.document).toMatchObject({
      Version: "1",
      Statement: [expect.objectContaining({ Resource: ["acs:quyan:*:owner:user/one"] })],
    });
    expect(result.delegation).toBe("allowed");
    expect(result.explanation).toEqual(["Read one user"]);
    expect(delegationCheck).toHaveBeenCalledWith(result.document);
    const call = generateTextForUser.mock.calls[0]!;
    expect(call[0]).toBe("child");
    expect(call[2]).toBe(input.model);
    expect(call[3]).toBe(input.relayTokenId);
    expect(call[1]).toContain("quyan:ram:ReadUser");
    expect(call[1]).not.toContain("alidns:AddDomainRecord");
    expect(call[4]).toMatchObject({
      maxOutputCharacters: IAM_POLICY_DRAFT_LIMITS.outputCharacters,
      signal: expect.any(AbortSignal),
    });
    expect(tryIncrementWithinLimit).toHaveBeenCalledWith(
      "iam:policy-draft:child",
      IAM_POLICY_DRAFT_LIMITS.requestsPerWindow,
      IAM_POLICY_DRAFT_LIMITS.windowSeconds,
    );
  });
  it("exposes same-resource dependencies to AI without adding grants to generated documents", async () => {
    const writeOnly = {
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: "quyan:system:error_report:UpdateErrorGroupStatus",
        Resource: "acs:platform:*:platform:error-group/group-one",
      },
    };
    generateTextForUser.mockResolvedValue(JSON.stringify({ document: writeOnly }));
    const result = await service.generate("child", "owner", input, delegationCheck);
    const prompt = generateTextForUser.mock.calls[0]![1] as string;
    const catalog = JSON.parse(
      prompt
        .split("\n")
        .find((line) => line.startsWith("Catalog: "))!
        .slice(9),
    );
    expect(
      catalog.actions.find((entry: { action: string }) => entry.action === writeOnly.Statement.Action),
    ).toMatchObject({ requiredActions: ["quyan:system:error_report:GetErrorGroup"] });
    expect(prompt).toContain("instead of broadening the draft");
    const statements = result.document?.Statement;
    expect(Array.isArray(statements) ? statements[0] : statements).toMatchObject({
      Action: [writeOnly.Statement.Action],
    });
  });
  it("gives AI exact resource slot names and conditional dependencies without widening its draft", async () => {
    generateTextForUser.mockResolvedValue(JSON.stringify({ document }));
    const result = await service.generate("child", "owner", input, delegationCheck);
    const prompt = generateTextForUser.mock.calls[0]![1] as string;
    const catalog = JSON.parse(
      prompt
        .split("\n")
        .find((line) => line.startsWith("Catalog: "))!
        .slice(9),
    );
    expect(catalog.resources.find((row: { id: string }) => row.id === "relay/submission-provider").arnTemplate).toBe(
      "acs:relay:*:{accountId}:submission-provider/{submitterUserId}/{channelId}/{providerUserId}",
    );
    expect(
      catalog.actions.find((row: { action: string }) => row.action === "quyan:remote_terminal:UpdateEntitlement"),
    ).toMatchObject({ conditionalActions: ["quyan:remote_terminal:DeleteEntitlement"] });
    expect(prompt).toContain("Do not grant every variant automatically");
    expect(prompt).toContain("Never substitute one identity for another");
    expect(result.document?.Statement).toEqual([
      expect.objectContaining({ Action: [document.Statement.Action], Resource: [document.Statement.Resource] }),
    ]);
  });
  it.each([
    '{"document":{"Version":"1","Statement":{"Effect":"Allow","Effect":"Deny","Action":"quyan:ram:ReadUser","Resource":"*"}}}',
    '{"document":{"Version":"1","Statement":{"Effect":"Allow","Action":"quyan:ram:ReadUser","Resource":"*"}},"document":{}}',
    '{"document":{"Version":"1","Statement":{"Effect":"Allow","Action":"quyan:ram:ReadUser","Resource":"*","__proto__":{}}}}',
    'Here is a policy: {"Version":"1","Statement":{"Effect":"Allow","Action":"quyan:ram:ReadUser","Resource":"*"}}',
    '{"Version":"1","Statement":{"Effect":"Allow","Action":"alidns:AddDomainRecord","Resource":"*"}}',
    '{"Version":"1","Statement":{"Effect":"Allow","Action":"quyan:ram:ReadUser","Resource":"acs:quyan:*:foreign:user/one"}}',
  ])(
    "rejects malformed, ambiguous and foreign generated content without salvaging an inner Allow (%s)",
    async (text) => {
      generateTextForUser.mockResolvedValue(text);
      const result = await service.generate("child", "owner", input, delegationCheck);
      expect(result.document).toBeUndefined();
      expect(result.riskLevel).toBe("high");
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "error",
            line: expect.any(Number),
            column: expect.any(Number),
            code: expect.any(String),
          }),
        ]),
      );
      expect(delegationCheck).not.toHaveBeenCalled();
    },
  );
  it("returns an expanded NotAction draft with warnings and proves the complete snapshot", async () => {
    generateTextForUser.mockResolvedValue(
      JSON.stringify({
        Version: "1",
        Statement: {
          Effect: "Allow",
          NotAction: "quyan:ram:DeleteUser",
          Resource: "acs:quyan:*:owner:user/one",
        },
      }),
    );
    const result = await service.generate("child", "owner", input, delegationCheck);
    expect([result.document?.Statement].flat()[0]).toHaveProperty("Action");
    expect(JSON.stringify(result.document)).not.toContain("NotAction");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "not-action-snapshot", severity: "security-warning" }),
    );
    expect(result.riskLevel).toBe("high");
    expect(delegationCheck).toHaveBeenCalledWith(result.document);
    expect(Object.keys(result)).not.toContain("policyId");
  });
  it("accepts an exact fenced response and a direct policy without losing the original JSON diagnostics", async () => {
    generateTextForUser.mockResolvedValue("```json\n" + JSON.stringify(document) + "\n```");
    expect((await service.generate("child", "owner", input, delegationCheck)).document).toBeDefined();
    generateTextForUser.mockResolvedValue(JSON.stringify(document));
    expect((await service.generate("child", "owner", input, delegationCheck)).document).toBeDefined();
  });
  it("returns denied delegation as high-risk review data, with no publication action", async () => {
    generateTextForUser.mockResolvedValue(JSON.stringify({ document, explanation: [], missingInformation: [] }));
    delegationCheck.mockResolvedValue({
      allowed: false,
      issues: [{ code: "missing-allow-coverage", action: "quyan:ram:ReadUser" }],
    });
    const result = await service.generate("child", "owner", input, delegationCheck);
    expect(result.delegation).toBe("denied");
    expect(result.riskLevel).toBe("high");
    expect(result.missingInformation.length).toBeGreaterThan(0);
    expect(Object.keys(result)).not.toContain("policyId");
    expect(Object.keys(result)).not.toContain("authorizationId");
  });
  it("requires later trust publication checks and rejects foreign trust principals", async () => {
    const trust = {
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: "quyan:ram:AssumeRole",
        Resource: "acs:quyan:*:owner:role/one",
        Principal: { RAM: "acs:quyan::owner:user/child" },
      },
    };
    generateTextForUser.mockResolvedValue(JSON.stringify(trust));
    const result = await service.generate("child", "owner", { ...input, policyKind: "trust" }, delegationCheck);
    expect(result.document).toBeDefined();
    expect(result.delegation).toBe("not-evaluated");
    expect(result.missingInformation.length).toBeGreaterThan(0);
    expect(delegationCheck).not.toHaveBeenCalled();
    trust.Statement.Principal.RAM = "acs:quyan::foreign:user/child";
    generateTextForUser.mockResolvedValue(JSON.stringify(trust));
    expect((await service.generate("child", "owner", { ...input, policyKind: "trust" })).document).toBeUndefined();
  });
  it("never calls the model when rate limiting fails or Redis is unavailable", async () => {
    tryIncrementWithinLimit.mockResolvedValue(-1);
    await expect(service.generate("child", "owner", input)).rejects.toMatchObject({ statusCode: 429 });
    tryIncrementWithinLimit.mockResolvedValue(null);
    await expect(service.generate("child", "owner", input)).rejects.toMatchObject({ statusCode: 500 });
    expect(generateTextForUser).not.toHaveBeenCalled();
  });
  it("does not swallow provider or delegation data failures into an approved draft", async () => {
    generateTextForUser.mockRejectedValue(new Error("fixture provider error"));
    await expect(service.generate("child", "owner", input, delegationCheck)).rejects.toThrow();
    generateTextForUser.mockResolvedValue(JSON.stringify(document));
    delegationCheck.mockRejectedValue(new Error("fixture policy read failure"));
    await expect(service.generate("child", "owner", input, delegationCheck)).rejects.toThrow();
  });
});

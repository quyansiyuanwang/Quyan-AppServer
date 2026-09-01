import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONTENT_SAFETY_RULES } from "@/util/content-safety-defaults";
import { ContentSafetyService } from "@/services/system/content-safety.service";

const CONTROL_CHARS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}\\u200b-\\u200f\\u202a-\\u202e\\u2060\\u2066-\\u2069]`,
  "g",
);
const normalize = (value: string) => value.normalize("NFKC").replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();

describe("content safety rule data", () => {
  it("caps matched actions at the configured maximum", () => {
    const service = Object.create(ContentSafetyService.prototype) as ContentSafetyService;
    const capEvaluation = (service as any).capEvaluation.bind(service);
    const base = {
      text: "secret",
      action: "unreachable",
      matched: true,
      source: "rule",
      auditInputTokens: 0,
      auditOutputTokens: 0,
      auditDurationMs: 0,
      auditCost: 0,
      matchText: "secret",
      matchContext: "secret",
    };
    expect(capEvaluation("secret", base, "allow").action).toBe("allow");
    expect(capEvaluation("secret", base, "blackhole").action).toBe("blackhole");
    expect(capEvaluation("secret", { ...base, action: "allow" }, "unreachable").action).toBe("allow");
  });

  it("keeps the strongest action when combining evaluations", () => {
    const service = Object.create(ContentSafetyService.prototype) as ContentSafetyService;
    const combine = (service as any).combineEvaluations.bind(service);
    const evaluation = (action: string) => ({
      text: "secret",
      action,
      matched: true,
      source: "rule",
      auditInputTokens: 0,
      auditOutputTokens: 0,
      auditDurationMs: 0,
      auditCost: 0,
    });
    expect(combine("secret", [evaluation("allow"), evaluation("blackhole")]).action).toBe("blackhole");
    expect(combine("secret", [evaluation("blackhole"), evaluation("unreachable")]).action).toBe("unreachable");
  });

  it("ships high-confidence defaults as importable data", () => {
    expect(DEFAULT_CONTENT_SAFETY_RULES.length).toBeGreaterThan(10);
    expect(DEFAULT_CONTENT_SAFETY_RULES.some((rule) => rule.pattern === "process.env")).toBe(true);
    expect(DEFAULT_CONTENT_SAFETY_RULES.every((rule) => rule.action === "unreachable")).toBe(true);
  });

  it("normalizes unicode and zero-width characters before matching", () => {
    expect(normalize("ｐｒｏｃｅｓｓ.ｅｎｖ\u200b")).toBe("process.env");
  });

  it("does not treat an example environment template as a secret file", () => {
    const rule = DEFAULT_CONTENT_SAFETY_RULES.find((item) => item.name === "Environment file access");
    expect(rule?.type).toBe("regex");
    const expression = new RegExp(rule!.pattern, "iu");
    expect(expression.test("Please create a .env.example template with placeholder values.")).toBe(false);
    expect(expression.test("cat .env.production")).toBe(true);
    expect(expression.test("cat .env")).toBe(true);
  });

  it("keeps legacy literal .env rules from matching .env.example", () => {
    const service = Object.create(ContentSafetyService.prototype) as ContentSafetyService;
    const matchRule = (service as any).matchRule.bind(service);
    expect(
      matchRule("create a .env.example template", [
        { id: "legacy", type: "literal", pattern: ".env", direction: "both", action: "unreachable", priority: 1 },
      ]),
    ).toBeNull();
    expect(
      matchRule("cat .env", [
        { id: "legacy", type: "literal", pattern: ".env", direction: "both", action: "unreachable", priority: 1 },
      ]),
    ).not.toBeNull();
  });

  it("rejects regexes that can match empty text", () => {
    expect(new RegExp("secret", "iu").test("")).toBe(false);
    expect(new RegExp(".*", "iu").test("")).toBe(true);
  });

  it("extracts bounded context around a matched fragment", () => {
    const service = Object.create(ContentSafetyService.prototype) as ContentSafetyService;
    const context = (service as any).extractMatchContext("prefix command cat /etc/shadow suffix", /\/etc\/shadow/iu);

    expect(context).toEqual({
      context: "prefix command cat /etc/shadow suffix",
      text: "/etc/shadow",
    });
  });

  it("records every match but only notifies for unreachable", async () => {
    const service = Object.create(ContentSafetyService.prototype) as any;
    const repository = { createIncident: vi.fn().mockResolvedValue({}) };
    const notificationService = { dispatch: vi.fn().mockResolvedValue(undefined) };
    const businessLog = { logOperation: vi.fn().mockResolvedValue(undefined) };
    service.repository = repository;
    service.notificationService = notificationService;
    service.businessLog = businessLog;
    const base = {
      text: "redacted",
      matched: true,
      source: "rule",
      auditInputTokens: 0,
      auditOutputTokens: 0,
      auditDurationMs: 0,
      auditCost: 0,
      ruleId: "rule-1",
      matchText: "secret",
      matchContext: "a secret",
    };

    await service.recordIncident({ userId: "user-1", direction: "request", evaluation: { ...base, action: "allow" } });
    await service.recordIncident({
      userId: "user-1",
      direction: "request",
      evaluation: { ...base, action: "blackhole" },
    });
    await service.recordIncident({
      userId: "user-1",
      direction: "request",
      evaluation: { ...base, action: "unreachable" },
    });

    expect(repository.createIncident).toHaveBeenCalledTimes(3);
    expect(notificationService.dispatch).toHaveBeenCalledTimes(1);
    expect(notificationService.dispatch).toHaveBeenCalledWith(
      "user-1",
      expect.anything(),
      expect.objectContaining({ action: "unreachable" }),
    );
  });

  it("takes the strictest maximum action across system, user, and token scopes", async () => {
    const service = Object.create(ContentSafetyService.prototype) as ContentSafetyService;
    vi.spyOn(service, "getPublicConfig").mockResolvedValue({
      requestEnabled: true,
      requestAction: "unreachable",
      requestMaxAction: "unreachable",
      requestAiEnabled: false,
      requestAiAction: "unreachable",
      responseEnabled: true,
      responseAction: "unreachable",
      responseMaxAction: "blackhole",
      responseAiEnabled: false,
      responseAiAction: "unreachable",
    } as any);
    vi.spyOn(service, "getUserConfig").mockResolvedValue({
      requestEnabled: null,
      requestAction: null,
      requestMaxAction: "blackhole",
      requestAiEnabled: null,
      requestAiAction: null,
      responseEnabled: null,
      responseAction: null,
      responseMaxAction: "unreachable",
      responseAiEnabled: null,
      responseAiAction: null,
    });

    const policy = await service.getEffectivePolicy("user-1", {
      requestMaxAction: "unreachable",
      responseMaxAction: "allow",
    });
    expect(policy.requestMaxAction).toBe("blackhole");
    expect(policy.responseMaxAction).toBe("allow");
  });

  it("does not dispatch notifications while updating system policy", async () => {
    const service = Object.create(ContentSafetyService.prototype) as any;
    const configService = {
      getMultiple: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const notificationService = { dispatch: vi.fn() };
    service.configService = configService;
    service.notificationService = notificationService;
    await service.updateConfig(
      {
        requestEnabled: true,
        requestAction: "unreachable",
        requestMaxAction: "unreachable",
        requestAiEnabled: false,
        responseEnabled: true,
        responseAction: "unreachable",
        responseMaxAction: "unreachable",
        responseAiEnabled: false,
        aiUpstreamUrl: "",
        aiModel: "",
        aiRequestFormat: "openai-chat-completions",
        aiTimeoutMs: 5000,
        aiInputPricePerMillion: 0,
        aiOutputPricePerMillion: 0,
        aiMaxTextLength: 16000,
      },
      "admin-1",
    );
    expect(notificationService.dispatch).not.toHaveBeenCalled();
  });
});

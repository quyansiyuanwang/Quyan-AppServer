import { describe, expect, it, vi } from "vitest";
import { ContentSafetyService } from "@/services/system/content-safety.service";
import {
  withContentSafetyAttempt,
  withContentSafetyGenerator,
  contentSafetyAttemptContext,
  attemptValue,
} from "@/services/system/content-safety-attempt";
import { DEFAULT_CONTENT_SAFETY_RULES, FULL_PRIVATE_KEY_PATTERN } from "@/util/content-safety-defaults";
import { productionSafetyRules } from "../fixtures/content-safety-production-rules";
import { AIResourceConfigService } from "@/services/infrastructure/ai-resource-config.service";
import { AI_RESOURCE_DEFAULTS } from "@/config/ai-resource-policy";
describe("attempt-scoped content safety", () => {
  it("allows ordinary system prompts, tools, code and configuration examples", () => {
    const rule = new RegExp(FULL_PRIVATE_KEY_PATTERN, "iu");
    for (const input of [
      "system: use tool_use and function_call",
      '<tool_call>{"command":"pwd","url":"https://example.test"}</tool_call>',
      'process.env.OPENAI_API_KEY = "your-key"',
      'child_process.exec("node -v"); subprocess.run(["pwd"])',
      "kubectl exec pod -- sh; curl -X POST https://example.test",
      "-----BEGIN PRIVATE KEY-----\n<placeholder>\n-----END PRIVATE KEY-----",
    ])
      expect(rule.test(input)).toBe(false);
    expect(DEFAULT_CONTENT_SAFETY_RULES).toHaveLength(1);
  });
  it("blocks complete synthetic key material but not mismatched or abbreviated markers", () => {
    const rule = new RegExp(FULL_PRIVATE_KEY_PATTERN, "iu");
    const material = "Abc123+/".repeat(20);
    expect(rule.test("-----BEGIN RSA PRIVATE KEY-----\n" + material + "\n-----END RSA PRIVATE KEY-----")).toBe(true);
    expect(rule.test("-----BEGIN RSA PRIVATE KEY-----\n" + material + "\n-----END EC PRIVATE KEY-----")).toBe(false);
    expect(rule.test("-----BEGIN PRIVATE KEY-----short-----END PRIVATE KEY-----")).toBe(false);
  });
  it("queries effective rules once per attempt and applies updates on the next attempt", async () => {
    let pattern = "secret";
    const repository = {
      listRulesForUser: vi.fn(async () => [
        { id: "r", type: "literal", pattern, direction: "both", action: "unreachable", priority: 1, ownerUserId: null },
      ]),
      getUserConfig: vi.fn(async () => null),
    };
    const configs = { getMultiple: vi.fn(async () => ({})) };
    const service = new (ContentSafetyService as any)(configs, repository, {}, {}, {});
    await withContentSafetyAttempt(async () => {
      await service.prepareAttempt({ userId: "u" });
      expect((await service.evaluateLocal("response", "secret", { userId: "u" })).matched).toBe(true);
      pattern = "updated";
      expect((await service.evaluateLocal("response", "updated", { userId: "u" })).matched).toBe(false);
    });
    expect(repository.listRulesForUser).toHaveBeenCalledTimes(1);
    expect(configs.getMultiple).toHaveBeenCalledTimes(1);
    await withContentSafetyAttempt(async () =>
      expect((await service.evaluateLocal("response", "updated", { userId: "u" })).matched).toBe(true),
    );
  });
  it("bounds compilation with 500 rules without skipping late matches", () => {
    const service = Object.create(ContentSafetyService.prototype) as any;
    const settings = structuredClone(AI_RESOURCE_DEFAULTS);
    settings.ruleCache.maxItems = 8;
    settings.ruleCache.maxEstimatedBytes = 4096;
    AIResourceConfigService.getInstance().apply(settings);
    const rules = Array.from({ length: 500 }, (_, i) => ({
      id: String(i),
      type: "literal",
      pattern: "rule_" + i + "_end",
      direction: "both",
      action: "unreachable",
      priority: i,
    }));
    expect(service.matchRule("rule_499_end", rules)?.rule.id).toBe("499");
    expect(service.compiledRules.size).toBeLessThanOrEqual(8);
    expect(service.compiledBytes).toBeLessThanOrEqual(4096);
    AIResourceConfigService.getInstance().apply(structuredClone(AI_RESOURCE_DEFAULTS));
  });
  it("previews a relaxed 93-row import as updates only", async () => {
    const rows = productionSafetyRules.map((row) => ({ ...row, ownerUserId: null, source: "csv" }));
    const repository = {
      listRulesForExport: vi.fn(async () => rows),
      ruleStats: vi.fn(async () => ({ count: 93, patternBytes: 16000 })),
    };
    const service = new (ContentSafetyService as any)({}, repository, {}, {}, {});
    const header = ["id", "name", "type", "pattern", "direction", "action", "enabled", "priority", "source"];
    const updated = rows.map((row) => ({
      ...row,
      enabled: row.name === "Private key material" ? "true" : "false",
      pattern: row.name === "Private key material" ? FULL_PRIVATE_KEY_PATTERN : row.pattern,
    }));
    const csv =
      header.join(",") +
      "\n" +
      updated
        .map((row) => header.map((key) => '"' + String((row as any)[key]).replaceAll('"', '""') + '"').join(","))
        .join("\n");
    const preview = await service.importCsv(csv, "preview", true);
    expect(preview.errors).toEqual([]);
    expect(preview.operations).toHaveLength(93);
    expect(preview.operations.every((op: any) => op.operation === "update")).toBe(true);
  });
  it("reproduces production false positives without production record identifiers", () => {
    expect(productionSafetyRules).toHaveLength(93);
    expect(
      productionSafetyRules.some((row) => new RegExp(row.pattern, "iu").test("function_call tool_use process.env")),
    ).toBe(true);
    expect(productionSafetyRules.every((row) => row.id.startsWith("legacy-"))).toBe(true);
  });
  it("pins a generator attempt across yields and releases its rules on cancellation", async () => {
    const owner = {},
      load = vi.fn(async () => ({ value: "snapshot" }));
    let scope: ReturnType<typeof contentSafetyAttemptContext.getStore>;
    const stream = withContentSafetyGenerator(async function* () {
      scope = contentSafetyAttemptContext.getStore();
      yield await attemptValue(owner, "rules", load);
      yield await attemptValue(owner, "rules", load);
    });
    const first = await stream.next();
    const second = await stream.next();
    expect(first.value).toBe(second.value);
    expect(load).toHaveBeenCalledOnce();
    await stream.return(undefined as never);
    expect(scope!.values.size).toBe(0);
  });
});

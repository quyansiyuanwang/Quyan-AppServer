import type { ContentSafetyService, ContentSafetyEvaluation } from "@/services/system/content-safety.service";
import type { CompositeExecutionContext } from "./relay-composite-executor.service";

/** Each policy is evaluated separately: a descendant cannot turn off an ancestor's safeguards. */
export function compositeSafetyService(
  base: ContentSafetyService,
  context?: CompositeExecutionContext,
): ContentSafetyService {
  if (!context) return base;
  const evaluate =
    (method: "evaluate" | "evaluateLocal") =>
    async (direction: "request" | "response", text: string, fallback?: any) => {
      if (direction !== "response") return base[method](direction, text, fallback);
      const evaluations: ContentSafetyEvaluation[] = [];
      for (const node of [...context.path].reverse()) {
        const evaluation = await base[method](direction, text, {
          userId: node.userId,
          tokenConfig: node.contentSafetyConfig as any,
        });
        evaluations.push(evaluation);
        if (evaluation.action === "blackhole") text = evaluation.text;
        if (evaluation.action === "unreachable") break;
      }
      const decisive =
        evaluations.find((item) => item.action === "unreachable") ??
        evaluations.find((item) => item.action === "blackhole") ??
        evaluations[0];
      return {
        ...decisive,
        text,
        matched: evaluations.some((item) => item.matched),
        components: evaluations,
        auditInputTokens: evaluations.reduce((sum, item) => sum + item.auditInputTokens, 0),
        auditOutputTokens: evaluations.reduce((sum, item) => sum + item.auditOutputTokens, 0),
        auditCost: evaluations.reduce((sum, item) => sum + item.auditCost, 0),
        auditDurationMs: evaluations.reduce((sum, item) => sum + item.auditDurationMs, 0),
      };
    };
  return new Proxy(base, {
    get: (target, key) => {
      if (key === "evaluate" || key === "evaluateLocal") return evaluate(key);
      if (key === "getEffectivePolicy")
        return async (userId: string, config?: any) => {
          const policies = await Promise.all(
            context.path.map((node) => base.getEffectivePolicy(node.userId, node.contentSafetyConfig as any)),
          );
          const effective = { ...(await base.getEffectivePolicy(userId, config)) };
          effective.responseEnabled = policies.some((policy) => policy.responseEnabled);
          effective.responseAiEnabled = policies.some((policy) => policy.responseEnabled && policy.responseAiEnabled);
          return effective;
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

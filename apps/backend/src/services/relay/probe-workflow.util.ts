import { BadRequestError } from "@/util/errors";

export function readProbeJsonPath(source: unknown, path: string): unknown {
  const normalized = path
    .trim()
    .replace(/^\$\.?/, "")
    .replace(/\["([^"\\]+)"\]/g, ".$1")
    .replace(/\['([^'\\]+)'\]/g, ".$1")
    .replace(/\[(\d+)\]/g, ".$1")
    .replace(/^\./, "");
  if (!normalized) return source;
  return normalized.split(".").reduce<unknown>((value, key) => {
    if (value == null || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, source);
}

export function interpolateRequiredProbeVariables(value: unknown, variables: Record<string, string>): unknown {
  if (typeof value === "string")
    return value.replace(/\{\{([A-Za-z][A-Za-z0-9_.]*)\}\}/g, (_, key) => {
      const resolved = variables[key];
      if (!resolved?.trim())
        throw new BadRequestError(`PROBE_VARIABLE_MISSING:${key}`, undefined, {
          messageKey: "relay.probeVariableMissing",
          messageParams: { variable: key },
        });
      return resolved;
    });
  if (Array.isArray(value)) return value.map((item) => interpolateRequiredProbeVariables(item, variables));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        interpolateRequiredProbeVariables(item, variables),
      ]),
    );
  return value;
}

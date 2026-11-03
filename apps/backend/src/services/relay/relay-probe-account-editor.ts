import { createHash } from "node:crypto";
import type { RelayChannelProbeLoginDto } from "@/api/dto/relay/relay-channel-probe.dto";
import type { ProbeAccountEncryptedConfiguration } from "@/store/relay/platform-relay-probe-account-update.repository";
import { BadRequestError, ConflictError } from "@/util/errors";

export function probeAccountRevision(configuration: ProbeAccountEncryptedConfiguration): string {
  return createHash("sha256")
    .update(
      JSON.stringify([configuration.encryptedCredentials, configuration.credentialIv, configuration.credentialAuthTag]),
    )
    .digest("hex");
}

export function assertProbeAccountRevision(
  expected: string | undefined,
  configuration: ProbeAccountEncryptedConfiguration,
) {
  if (expected !== undefined && expected !== probeAccountRevision(configuration))
    throw new ConflictError("Probe account configuration changed", undefined, {
      messageKey: "relayChannelProbe.accountConfigurationChanged",
    });
}

/** All literal request values may contain secrets, including URLs and nested JSON. */
export function projectProbeLoginForEditor(workflow: RelayChannelProbeLoginDto) {
  const retainedFields: string[][] = [];
  const required = new Set<string>();
  const visit = (value: unknown, path: string[]): unknown => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/\{\{([A-Za-z][A-Za-z0-9_.]*)\}\}/g)) required.add(match[1]!);
      // A standalone variable reference carries no saved credential value.
      if (/^(?:Bearer |Basic )?\{\{[A-Za-z][A-Za-z0-9_.]*\}\}$/.test(value)) return value;
    }
    if (Array.isArray(value)) return value.map((item, index) => visit(item, [...path, String(index)]));
    if (value !== null && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, [...path, key])]));
    retainedFields.push(path);
    return "";
  };
  const { method, ...fields } = workflow;
  const projected = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, visit(value, [key])]));
  return {
    loginWorkflow: { method, ...projected } as RelayChannelProbeLoginDto,
    retainedFields,
    requiredCredentialNames: [...required].sort(),
  };
}

export function restoreProbeLoginFields(
  workflow: RelayChannelProbeLoginDto,
  previous: RelayChannelProbeLoginDto | undefined,
  paths: string[][] = [],
): RelayChannelProbeLoginDto {
  const result = structuredClone(workflow);
  const invalid = () =>
    new BadRequestError("Invalid retained probe account field", undefined, { messageKey: "errors.badRequest" });
  for (const path of paths) {
    if (!previous || !["url", "headers", "query", "body"].includes(path[0] ?? "") || path.length > 20 || !path.length)
      throw invalid();
    let source: unknown = previous;
    let target: unknown = result;
    for (const [index, key] of path.entries()) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw invalid();
      if (
        !source ||
        typeof source !== "object" ||
        !Object.hasOwn(source, key) ||
        !target ||
        typeof target !== "object" ||
        !Object.hasOwn(target, key)
      )
        throw invalid();
      const from = source as Record<string, unknown>;
      const to = target as Record<string, unknown>;
      if (index === path.length - 1) {
        if (to[key] !== "" || (from[key] !== null && typeof from[key] === "object")) throw invalid();
        to[key] = from[key];
      } else {
        source = from[key];
        target = to[key];
      }
    }
  }
  return result;
}

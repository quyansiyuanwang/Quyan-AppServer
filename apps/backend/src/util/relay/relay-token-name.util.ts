import { RELAY_TOKEN_CREATION_LIMITS } from "@/constant/relay-token";
import { BadRequestError } from "@/util/errors";
/** Common copy suffix/length semantics for legacy and native token creation. */
export function* relayTokenCopyNames(baseName: string): Generator<string> {
  for (let index = 1; index <= RELAY_TOKEN_CREATION_LIMITS.copyNameAttempts; index++) {
    const suffix = index === 1 ? "（副本）" : `（副本${index}）`;
    const base = baseName.slice(0, Math.max(1, RELAY_TOKEN_CREATION_LIMITS.nameLength - suffix.length)).trim();
    yield `${base}${suffix}`;
  }
  throw new BadRequestError("Unable to generate a unique relay token name", undefined, {
    messageKey: "relayToken.nameGenerationFailed",
  });
}

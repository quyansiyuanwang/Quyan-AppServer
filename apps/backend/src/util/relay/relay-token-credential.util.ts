import { randomBytes } from "node:crypto";
import { getCredentialPrefix } from "@quyan/shared";
/** Server-only credential generation shared by creation and atomic rotation. */
export function generateRelayTokenValue(): string {
  return `${getCredentialPrefix("relayToken")}${randomBytes(32).toString("hex")}`;
}

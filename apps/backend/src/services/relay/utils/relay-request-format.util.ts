import { BadRequestError } from "@/util/errors";
import type { RelayRequestFormat } from "@/util/relay";
import type { RelayRequestLike } from "../types/relay-proxy.types";

const PREFIX = "/relay/proxy";
const OPENAI_PATHS = [
  "/chat/completions",
  "/responses",
  "/images/generations",
  "/images/edits",
  "/images/variations",
  "/v1/chat/completions",
  "/v1/responses",
  "/v1/images/generations",
  "/v1/images/edits",
  "/v1/images/variations",
].map((path) => PREFIX + path);
const ANTHROPIC_PATHS = ["/messages", "/v1/messages"].map((path) => PREFIX + path);

export const isRelayOpenAIRequestFormat = (format: RelayRequestFormat): boolean =>
  format === "openai" || format.startsWith("openai-");

export const isRelayOpenAIPath = (path: string): boolean => {
  if (OPENAI_PATHS.some((candidate) => path.startsWith(candidate))) return true;
  if (!path.startsWith(PREFIX)) return false;
  return /^\/v\d+(?:beta)?\/(chat\/completions|responses|images?\/(generations?|edits?|variations?))/.test(
    path.slice(PREFIX.length),
  );
};

export const isRelayGeminiPath = (path: string): boolean =>
  path.includes("/models/") && (path.includes("generateContent") || path.includes("streamGenerateContent"));

export const isRelayAnthropicPath = (path: string): boolean => {
  if (ANTHROPIC_PATHS.some((candidate) => path.startsWith(candidate))) return true;
  return path.startsWith(PREFIX) && /^\/v\d+(?:beta)?\/messages/.test(path.slice(PREFIX.length));
};

export const resolveRelayRequestFormat = (req: RelayRequestLike): RelayRequestFormat => {
  const requestPath = String(req.path || "");
  if (isRelayGeminiPath(requestPath)) return "gemini";
  if (/\/(?:v\d+(?:beta)?\/)?responses(?:$|[/?])/.test(requestPath)) return "openai-responses";
  if (isRelayOpenAIPath(requestPath)) return "openai-chat-completions";
  if (isRelayAnthropicPath(requestPath)) return "anthropic";
  if (requestPath === PREFIX || requestPath === `${PREFIX}/`)
    throw new BadRequestError(
      "Missing API endpoint path. Please specify a valid endpoint like /relay/proxy/v1/chat/completions or /relay/proxy/v1/images/generations.",
    );
  throw new BadRequestError(
    `Unsupported request path for format detection: ${requestPath}. Only OpenAI (/chat/completions, /responses, /images/generations, /images/edits, /images/variations), Anthropic (/messages), and Gemini (/models/*:generateContent or :streamGenerateContent) are allowed.`,
  );
};

export const extractRelayRequestedModel = (req: RelayRequestLike, requestFormat: RelayRequestFormat): string | null => {
  const body = req.body as Record<string, unknown> | undefined;
  if (body && typeof body.model === "string") return body.model;
  if (requestFormat === "openai-chat-completions" && Buffer.isBuffer(req.body)) {
    const match = req.body.toString("utf8").match(/name="model"\r\n\r\n([^\r\n]+)/i);
    return match?.[1]?.trim() || null;
  }
  if (requestFormat === "gemini") {
    const path = req.originalUrl || req.url || req.path || "";
    return path.match(/\/models\/([^/:]+):/)?.[1] || path.match(/\/models\/([^/]+)\//)?.[1] || null;
  }
  return null;
};

export const buildRelayUpstreamPath = (
  requestPath: string,
  requestFormat: RelayRequestFormat,
  upstreamModelId: string,
): string => {
  const normalizedPath = requestPath.replace(/^\/relay\/proxy/, "");
  if (requestFormat !== "gemini") return normalizedPath;
  return normalizedPath.replace(/(\/models\/)([^/:]+)(?=[:/])/, `$1${encodeURIComponent(upstreamModelId)}`);
};

export const buildRelayForwardBody = (
  body: unknown,
  requestFormat: RelayRequestFormat,
  upstreamModelId: string,
): unknown => {
  if (Buffer.isBuffer(body) || !body || typeof body !== "object") return body;
  const clone = Array.isArray(body) ? [...body] : { ...(body as Record<string, unknown>) };
  if (requestFormat !== "gemini" || "model" in clone) (clone as Record<string, unknown>).model = upstreamModelId;
  return clone;
};

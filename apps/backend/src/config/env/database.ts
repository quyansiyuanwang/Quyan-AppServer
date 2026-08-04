import { redactDatabaseUrl } from "./common";
import type { EnvSnapshot } from "./source";

export function buildDatabaseConfig(source: EnvSnapshot) {
  const url = source.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not defined in environment variables");
  const queryIndex = url.indexOf("?");

  return {
    url,
    hiddenUrl: redactDatabaseUrl(url),
    params: queryIndex === -1 ? "—" : url.slice(queryIndex + 1),
  };
}

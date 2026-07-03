import type { ServerConfig } from "@prisma/client";

export interface ServerConfigStore {
  findByKey(key: string): Promise<ServerConfig | null>;
  upsert(key: string, value: string): Promise<ServerConfig>;
  findByKeys(keys: string[]): Promise<ServerConfig[]>;
  findAll(): Promise<ServerConfig[]>;
}

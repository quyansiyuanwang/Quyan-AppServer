import { prisma } from "@/config/database";
import type { ServerConfig } from "@prisma/client";
import type { ServerConfigStore } from "./server-config.store";

export class ServerConfigRepository implements ServerConfigStore {
  private static instance: ServerConfigRepository;

  public static getInstance(): ServerConfigRepository {
    if (!ServerConfigRepository.instance) ServerConfigRepository.instance = new ServerConfigRepository();

    return ServerConfigRepository.instance;
  }

  async findByKey(key: string): Promise<ServerConfig | null> {
    return prisma.serverConfig.findUnique({ where: { key } });
  }

  async upsert(key: string, value: string): Promise<ServerConfig> {
    return prisma.serverConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  async findByKeys(keys: string[]): Promise<ServerConfig[]> {
    if (keys.length === 0) return [];

    return prisma.serverConfig.findMany({
      where: {
        key: {
          in: keys,
        },
      },
    });
  }

  async findAll(): Promise<ServerConfig[]> {
    return prisma.serverConfig.findMany();
  }
}

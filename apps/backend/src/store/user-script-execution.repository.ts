import { UserScriptExecution } from "@prisma/client";
import { prisma } from "@/config/database";
import { getLogger, LogCategory } from "@/util/logger";

const logger = getLogger("UserScriptExecutionRepository", LogCategory.STORAGE);

export interface CreateExecutionParams {
  userId: string;
  scriptId?: string;
  scriptName: string;
  contentSnapshot: string;
  output: string;
  durationMs: number;
}

export class UserScriptExecutionRepository {
  private static instance: UserScriptExecutionRepository;

  public static getInstance(): UserScriptExecutionRepository {
    if (!UserScriptExecutionRepository.instance)
      UserScriptExecutionRepository.instance = new UserScriptExecutionRepository();
    return UserScriptExecutionRepository.instance;
  }

  public async create(params: CreateExecutionParams): Promise<UserScriptExecution> {
    try {
      return await prisma.userScriptExecution.create({ data: params });
    } catch (error) {
      logger.error("Failed to create user script execution", error);
      throw error;
    }
  }

  public async findByUserId(userId: string, limit = 50): Promise<UserScriptExecution[]> {
    try {
      return await prisma.userScriptExecution.findMany({
        where: { userId },
        orderBy: { createTime: "desc" },
        take: limit,
      });
    } catch (error) {
      logger.error(`Failed to find executions for user: ${userId}`, error);
      throw error;
    }
  }

  public async findByScriptId(scriptId: string, userId: string, limit = 50): Promise<UserScriptExecution[]> {
    try {
      return await prisma.userScriptExecution.findMany({
        where: { scriptId, userId },
        orderBy: { createTime: "desc" },
        take: limit,
      });
    } catch (error) {
      logger.error(`Failed to find executions for script: ${scriptId}`, error);
      throw error;
    }
  }
}

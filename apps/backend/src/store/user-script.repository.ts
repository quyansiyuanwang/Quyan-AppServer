import { UserScript } from "@prisma/client";
import { prisma } from "@/config/database";
import { getLogger, LogCategory } from "@/util/logger";
import { MANAGED_STATUS } from "@/constant/status";

const logger = getLogger("UserScriptRepository", LogCategory.STORAGE);

export interface CreateUserScriptParams {
  userId: string;
  name: string;
  description?: string;
  content: string;
}

export interface UpdateUserScriptParams {
  name?: string;
  description?: string;
  content?: string;
}

export class UserScriptRepository {
  private static instance: UserScriptRepository;

  public static getInstance(): UserScriptRepository {
    if (!UserScriptRepository.instance) UserScriptRepository.instance = new UserScriptRepository();
    return UserScriptRepository.instance;
  }

  public async create(params: CreateUserScriptParams): Promise<UserScript> {
    try {
      return await prisma.userScript.create({ data: params });
    } catch (error) {
      logger.error("Failed to create user script", error);
      throw error;
    }
  }

  public async findById(id: string): Promise<UserScript | null> {
    try {
      return await prisma.userScript.findUnique({
        where: { id, status: MANAGED_STATUS.ENABLED },
      });
    } catch (error) {
      logger.error(`Failed to find user script by id: ${id}`, error);
      throw error;
    }
  }

  public async findByUserId(userId: string): Promise<UserScript[]> {
    try {
      return await prisma.userScript.findMany({
        where: { userId, status: MANAGED_STATUS.ENABLED },
        orderBy: { createTime: "desc" },
      });
    } catch (error) {
      logger.error(`Failed to find user scripts for user: ${userId}`, error);
      throw error;
    }
  }

  public async update(id: string, params: UpdateUserScriptParams): Promise<UserScript> {
    try {
      return await prisma.userScript.update({ where: { id }, data: params });
    } catch (error) {
      logger.error(`Failed to update user script: ${id}`, error);
      throw error;
    }
  }

  public async delete(id: string): Promise<void> {
    try {
      await prisma.userScript.update({
        where: { id },
        data: { status: MANAGED_STATUS.DELETED },
      });
    } catch (error) {
      logger.error(`Failed to delete user script: ${id}`, error);
      throw error;
    }
  }
}

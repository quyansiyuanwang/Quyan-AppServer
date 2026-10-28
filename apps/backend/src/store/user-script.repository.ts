import { Prisma, UserScript } from "@prisma/client";
import { prisma } from "@/config/database";
import { getLogger, LogCategory } from "@/util/logger";
import { MANAGED_STATUS } from "@/constant/status";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { ForbiddenError } from "@/util/errors";

export const userScriptTargetSelect = { id: true, userId: true, createTime: true, updateTime: true } as const;
export type UserScriptTarget = Prisma.UserScriptGetPayload<{ select: typeof userScriptTargetSelect }>;
const scriptAccountScope = (userId: string, accountOwnerId: string): Prisma.UserScriptWhereInput => ({
  userId,
  status: MANAGED_STATUS.ENABLED,
  user: { status: MANAGED_STATUS.ENABLED, OR: [{ accountOwnerId }, { id: accountOwnerId, accountOwnerId: null }] },
});
const staleTarget = () =>
  new ForbiddenError("Script authorization snapshot changed", undefined, {
    messageKey: "permission.insufficientPermission",
  });

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

  public findTarget(id: string, userId: string, accountOwnerId: string) {
    return prisma.userScript.findFirst({
      where: { id, ...scriptAccountScope(userId, accountOwnerId) },
      select: userScriptTargetSelect,
    });
  }

  public scanTargets(userId: string, accountOwnerId: string, after?: UserScriptTarget) {
    return prisma.userScript.findMany({
      where: {
        ...scriptAccountScope(userId, accountOwnerId),
        ...(after
          ? {
              OR: [{ createTime: { lt: after.createTime } }, { createTime: after.createTime, id: { lt: after.id } }],
            }
          : {}),
      },
      select: userScriptTargetSelect,
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }

  public async readTargets(
    userId: string,
    accountOwnerId: string,
    targets: readonly UserScriptTarget[],
  ): Promise<UserScript[]> {
    if (!targets.length) return Promise.resolve([]);
    return prisma.userScript.findMany({
      where: {
        ...scriptAccountScope(userId, accountOwnerId),
        OR: targets.map((target) => ({ id: target.id, updateTime: target.updateTime })),
      },
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
    });
  }

  public async createInAccount(params: CreateUserScriptParams, accountOwnerId: string) {
    return prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findFirst({
          where: {
            id: params.userId,
            status: MANAGED_STATUS.ENABLED,
            OR: [{ accountOwnerId }, { id: accountOwnerId, accountOwnerId: null }],
          },
          select: { id: true },
        });
        if (user?.id !== params.userId) throw staleTarget();
        return tx.userScript.create({ data: params });
      },
      { isolationLevel: "Serializable" },
    );
  }

  public async updateTarget(target: UserScriptTarget, accountOwnerId: string, data: UpdateUserScriptParams) {
    return prisma.$transaction(
      async (tx) => {
        const changed = await tx.userScript.updateMany({
          where: { id: target.id, updateTime: target.updateTime, ...scriptAccountScope(target.userId, accountOwnerId) },
          data,
        });
        if (changed.count !== 1) throw staleTarget();
        const script = await tx.userScript.findFirst({
          where: { id: target.id, ...scriptAccountScope(target.userId, accountOwnerId) },
        });
        if (!script || script.id !== target.id || script.userId !== target.userId) throw staleTarget();
        return script;
      },
      { isolationLevel: "Serializable" },
    );
  }

  public async deleteTarget(target: UserScriptTarget, accountOwnerId: string) {
    const changed = await prisma.userScript.updateMany({
      where: { id: target.id, updateTime: target.updateTime, ...scriptAccountScope(target.userId, accountOwnerId) },
      data: { status: MANAGED_STATUS.DELETED },
    });
    if (changed.count !== 1) throw staleTarget();
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

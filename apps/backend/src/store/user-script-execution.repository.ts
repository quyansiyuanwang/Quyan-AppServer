import { Prisma, UserScriptExecution } from "@prisma/client";
import { prisma } from "@/config/database";
import { getLogger, LogCategory } from "@/util/logger";

import { SCRIPT_EXECUTION_LIMITS } from "@/services/user-script/execution-limits";
import { ForbiddenError } from "@/util/errors";
import { isCanonicalScriptId } from "@/iam/resources/script-resources";
import type { UserScriptTarget } from "./user-script.repository";

export const scriptExecutionTargetSelect = { id: true, userId: true, scriptId: true, createTime: true } as const;
export type UserScriptExecutionTarget = Prisma.UserScriptExecutionGetPayload<{
  select: typeof scriptExecutionTargetSelect;
}>;
const executionAccountScope = (userId: string, accountOwnerId: string): Prisma.UserScriptExecutionWhereInput => ({
  userId,
  user: { status: 1, OR: [{ accountOwnerId }, { id: accountOwnerId, accountOwnerId: null }] },
  // Preserve snapshots of deleted scripts, but never trust historic foreign-user associations.
  OR: [{ scriptId: null }, { script: { userId } }],
});
const invalidAssociation = () =>
  new ForbiddenError("Script execution association unavailable", undefined, { messageKey: "userScript.historyDenied" });

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

  public async create(
    params: CreateExecutionParams,
    accountOwnerId?: string,
    expectedScript?: UserScriptTarget,
  ): Promise<UserScriptExecution> {
    if (params.scriptId !== undefined && !isCanonicalScriptId(params.scriptId)) throw invalidAssociation();
    return prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: params.userId },
          select: { id: true, accountOwnerId: true, status: true },
        });
        if (
          !user ||
          user.id !== params.userId ||
          user.status !== 1 ||
          (accountOwnerId && (user.accountOwnerId || user.id) !== accountOwnerId)
        )
          throw invalidAssociation();
        if (params.scriptId !== undefined) {
          const script = await tx.userScript.findFirst({
            where: { id: params.scriptId, userId: params.userId, status: 1 },
            select: { id: true, userId: true, updateTime: true },
          });
          if (
            !script ||
            script.id !== params.scriptId ||
            script.userId !== params.userId ||
            (expectedScript &&
              (script.id !== expectedScript.id || script.updateTime.getTime() !== expectedScript.updateTime.getTime()))
          )
            throw invalidAssociation();
        } else if (expectedScript) throw invalidAssociation();
        return tx.userScriptExecution.create({ data: params });
      },
      { isolationLevel: "Serializable" },
    );
  }

  public scanTargets(userId: string, accountOwnerId: string, scriptId?: string, after?: UserScriptExecutionTarget) {
    return prisma.userScriptExecution.findMany({
      where: {
        AND: [
          executionAccountScope(userId, accountOwnerId),
          ...(scriptId ? [{ scriptId }] : []),
          ...(after
            ? [
                {
                  OR: [
                    { createTime: { lt: after.createTime } },
                    { createTime: after.createTime, id: { lt: after.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      select: scriptExecutionTargetSelect,
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      take: SCRIPT_EXECUTION_LIMITS.metadataBatch,
    });
  }

  public async readTargets(
    userId: string,
    accountOwnerId: string,
    targets: readonly UserScriptExecutionTarget[],
  ): Promise<UserScriptExecution[]> {
    if (!targets.length) return [];
    return prisma.userScriptExecution.findMany({
      where: {
        AND: [
          executionAccountScope(userId, accountOwnerId),
          {
            OR: targets.map((target) => ({ id: target.id, scriptId: target.scriptId, createTime: target.createTime })),
          },
        ],
      },
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
    });
  }

  public async findByUserId(
    userId: string,
    limit = SCRIPT_EXECUTION_LIMITS.responseRecords,
  ): Promise<UserScriptExecution[]> {
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

  public async findByScriptId(
    scriptId: string,
    userId: string,
    limit = SCRIPT_EXECUTION_LIMITS.responseRecords,
  ): Promise<UserScriptExecution[]> {
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

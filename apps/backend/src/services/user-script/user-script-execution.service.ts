import { UserScriptExecution } from "@prisma/client";
import { UserScriptExecutionRepository } from "@/store/user-script-execution.repository";
import { UserScriptRepository } from "@/store/user-script.repository";
import type { CreateExecutionDto, UserScriptExecutionDto } from "@/api/dto/user-script/user-script-execution.dto";
import { ForbiddenError, NotFoundError } from "@/util/errors";

export class UserScriptExecutionService {
  private static instance: UserScriptExecutionService;

  private constructor(
    private readonly repository: UserScriptExecutionRepository = UserScriptExecutionRepository.getInstance(),
    private readonly scriptRepository: UserScriptRepository = UserScriptRepository.getInstance(),
  ) {}

  public static getInstance(): UserScriptExecutionService {
    if (!UserScriptExecutionService.instance) UserScriptExecutionService.instance = new UserScriptExecutionService();
    return UserScriptExecutionService.instance;
  }

  private mapToDto(execution: UserScriptExecution): UserScriptExecutionDto {
    return {
      id: execution.id,
      userId: execution.userId,
      scriptId: execution.scriptId ?? undefined,
      scriptName: execution.scriptName,
      contentSnapshot: execution.contentSnapshot,
      output: execution.output,
      durationMs: execution.durationMs,
      createTime: execution.createTime.toISOString(),
    };
  }

  public async saveExecution(userId: string, dto: CreateExecutionDto): Promise<UserScriptExecutionDto> {
    const execution = await this.repository.create({
      userId,
      scriptId: dto.scriptId,
      scriptName: dto.scriptName,
      contentSnapshot: dto.contentSnapshot,
      output: dto.output,
      durationMs: dto.durationMs,
    });
    return this.mapToDto(execution);
  }

  public async listExecutions(userId: string): Promise<UserScriptExecutionDto[]> {
    const executions = await this.repository.findByUserId(userId);
    return executions.map((e) => this.mapToDto(e));
  }

  public async listExecutionsByScript(scriptId: string, userId: string): Promise<UserScriptExecutionDto[]> {
    const script = await this.scriptRepository.findById(scriptId);
    if (!script) throw new NotFoundError("脚本不存在");
    if (script.userId !== userId) throw new ForbiddenError("无权查看此脚本的历史");

    const executions = await this.repository.findByScriptId(scriptId, userId);
    return executions.map((e) => this.mapToDto(e));
  }
}

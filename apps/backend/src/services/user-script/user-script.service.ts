import { UserScript } from "@prisma/client";
import { UserScriptRepository } from "@/store/user-script.repository";
import type { CreateUserScriptDto, UpdateUserScriptDto, UserScriptDto } from "@/api/dto/user-script/user-script.dto";
import { NotFoundError, ForbiddenError } from "@/util/errors";

export class UserScriptService {
  private static instance: UserScriptService;

  private constructor(private readonly repository: UserScriptRepository = UserScriptRepository.getInstance()) {}

  public static getInstance(): UserScriptService {
    if (!UserScriptService.instance) UserScriptService.instance = new UserScriptService();
    return UserScriptService.instance;
  }

  private mapToDto(script: UserScript): UserScriptDto {
    return {
      id: script.id,
      userId: script.userId,
      name: script.name,
      description: script.description || undefined,
      content: script.content,
      createTime: script.createTime.toISOString(),
      updateTime: script.updateTime.toISOString(),
    };
  }

  public async createScript(data: CreateUserScriptDto, userId: string): Promise<UserScriptDto> {
    const script = await this.repository.create({
      userId,
      name: data.name,
      description: data.description,
      content: data.content,
    });
    return this.mapToDto(script);
  }

  public async listScripts(userId: string): Promise<UserScriptDto[]> {
    const scripts = await this.repository.findByUserId(userId);
    return scripts.map((s) => this.mapToDto(s));
  }

  public async updateScript(id: string, data: UpdateUserScriptDto, userId: string): Promise<UserScriptDto> {
    const script = await this.repository.findById(id);
    if (!script) throw new NotFoundError("脚本不存在");
    if (script.userId !== userId) throw new ForbiddenError("无权修改此脚本");

    const updated = await this.repository.update(id, {
      name: data.name,
      description: data.description,
      content: data.content,
    });
    return this.mapToDto(updated);
  }

  public async deleteScript(id: string, userId: string): Promise<void> {
    const script = await this.repository.findById(id);
    if (!script) throw new NotFoundError("脚本不存在");
    if (script.userId !== userId) throw new ForbiddenError("无权删除此脚本");

    await this.repository.delete(id);
  }
}

export interface CreateExecutionDto {
  scriptId?: string;
  scriptName: string;
  contentSnapshot: string;
  output: string;
  durationMs: number;
}

export interface UserScriptExecutionDto {
  id: string;
  userId: string;
  scriptId?: string;
  scriptName: string;
  contentSnapshot: string;
  output: string;
  durationMs: number;
  createTime: string;
}

export interface CreateUserScriptDto {
  name: string;
  description?: string;
  content: string;
}

export interface UpdateUserScriptDto {
  name?: string;
  description?: string;
  content?: string;
}

export interface UserScriptDto {
  id: string;
  userId: string;
  name: string;
  description?: string;
  content: string;
  createTime: string;
  updateTime: string;
}

export interface UserScript {
  id: string
  userId: string
  name: string
  description?: string
  content: string
  createTime: string
  updateTime: string
}

export interface UserScriptExecution {
  id: string
  scriptId?: string
  scriptName: string
  output: string
  durationMs: number
  createTime: string
}

export type ExecStatus = 'running' | 'done' | 'error' | 'terminated'

export interface ExecRecord {
  id: string
  scriptId: string
  scriptName: string
  status: ExecStatus
  output: string
  startTime: number
  durationMs?: number
  worker?: Worker
}

export interface ScriptFormData {
  name: string
  description: string
  content: string
}
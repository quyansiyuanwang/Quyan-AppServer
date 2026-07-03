import type { CustomCode } from '@/constant/custom-code'

// '确定'响应体包装器
export interface DeterminedResponse<T> {
  code: CustomCode
  message: string
  data: T
}
export type PromDeResp<T> = Promise<DeterminedResponse<T>>

// 类型安全的响应获取器
// export type GetResponse<T extends keyof typeof Endpoints> = ResponseDataMap[T]
// 常规响应包装器
export type Response<T> = DeterminedResponse<T | null>
export type PromResp<T> = Promise<Response<T>>

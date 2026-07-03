import { CustomCode } from '@/constant/custom-code'
import { toServiceError } from '@/utils/error-utils'

/**
 * 检查 API 响应结果，处理 2FA 和错误情况
 * @param result API 响应结果
 * @param requireData 是否要求返回 data 字段
 * @returns 如果成功或需要 2FA，返回 result；否则抛出错误
 */
export function checkApiResult<T = any>(result: any, requireData: boolean = false): T {
  // 特殊处理：如果是 2FA 要求，不抛出错误（2FA 流程会自动处理）
  if (result && result.code === CustomCode.TWO_FACTOR_REQUIRED) {
    return result as T
  }

  // 检查是否成功
  if (result && result.code === CustomCode.OK) {
    // 如果要求返回 data，检查 data 是否存在
    if (requireData && !result.data) {
      throw toServiceError(result)
    }
    return result as T
  }

  // 其他情况抛出错误
  throw toServiceError(result)
}

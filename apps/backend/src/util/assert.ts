import { ApiError } from "./errors";

/**
 * 断言条件为真，否则抛出错误
 * @param condition 要检查的条件
 * @param error 条件为假时抛出的错误
 * @throws 如果条件为假，抛出指定的错误
 */
export function assert(condition: unknown, error: Error | string): asserts condition {
  if (!condition) {
    if (typeof error === "string") throw new Error(error);

    throw error;
  }
}

/**
 * 断言值存在（非 null 或 undefined），否则抛出错误
 * @param value 要检查的值
 * @param error 值不存在时抛出的错误
 * @returns 断言后的值（类型收窄）
 * @throws 如果值不存在，抛出指定的错误
 */
export function assertExists<T>(value: T | null | undefined, error: Error | string): asserts value is T {
  if (value === null || value === undefined) {
    if (typeof error === "string") throw new Error(error);

    throw error;
  }
}

/**
 * 断言值存在（非 null、undefined 或 false），否则抛出错误
 * 这是一个更严格的版本，也会将 false、0、"" 视为不存在
 * @param value 要检查的值
 * @param error 值不存在时抛出的错误
 * @returns 断言后的值（类型收窄）
 * @throws 如果值不存在，抛出指定的错误
 */
export function assertTruthy<T>(
  value: T | null | undefined | false | 0 | "",
  error: Error | string,
): asserts value is T {
  if (!value) {
    if (typeof error === "string") throw new Error(error);

    throw error;
  }
}

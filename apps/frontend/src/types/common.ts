type Union<T extends readonly any[]> = T[number]

/** WARN: If u use this type, may 'cause the arg names to be inferred incorrectly */
type Callable<A extends any[] = undefined[], RT = any> = (...args: A) => RT

// 反转映射类型
type ReverseMapping<T extends Record<any, any>> = {
  [V in T[keyof T]]: {
    [K in keyof T]: T[K] extends V ? K : never
  }[keyof T]
}

// 提取嵌套对象中的所有值类型
type DeepValues<T> =
  T extends Record<string, any>
    ? {
        [K in keyof T]: T[K] extends string
          ? T[K]
          : T[K] extends Record<string, any>
            ? DeepValues<T[K]>
            : never
      }[keyof T]
    : never

// 将嵌套对象的所有值类型转换为 string
type DeepStringify<T> = {
  [K in keyof T]: T[K] extends object ? DeepStringify<T[K]> : string
}

// 提取嵌套对象的所有键，使用分隔符连接
// 如果值是字典则不把键联合进类型，只返回递归的嵌套键
type NestedKeys<T, C extends string = '.'> =
  T extends Record<string, any>
    ? {
        [K in Extract<keyof T, string>]: T[K] extends Record<string, any>
          ? `${K}${C}${NestedKeys<T[K], C>}`
          : K
      }[Extract<keyof T, string>]
    : never

// 类型断言
type Assert<T extends true> = T

// 类型相等判断
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

// 使用一个辅助计数器 `I` 来限制递归次数到 N, 避免根据输入元组长度递归导致的深度爆炸
type Drop<T extends any[], N extends number, I extends any[] = []> = I['length'] extends N
  ? T
  : T extends [any, ...infer R]
    ? Drop<R, N, [...I, any]>
    : []

// 获取元组的尾部类型, 排除前面 N 个元素. 默认 N = 1
type Tail<T extends any[], N extends number = 1> = Drop<T, N>

// 提取字符串中的占位符键
type ExtractKeys<S extends string> = S extends `${infer _Start}{${infer Key}}${infer Rest}`
  ? Key | ExtractKeys<Rest>
  : never

// 定义占位符对象类型
type StrictObj<S extends string> = {
  [K in ExtractKeys<S>]: any
}

// 从对象类型 T 中提取所有非 never 的属性
type WithoutNever<T> = {
  [K in keyof T as T[K] extends never ? never : K]: T[K]
}

export type {
  Union,
  Callable,
  ReverseMapping,
  DeepValues,
  NestedKeys,
  Assert,
  Equal,
  DeepStringify,
  Drop,
  Tail,
  ExtractKeys,
  StrictObj,
  WithoutNever,
}

export type DeepStringify<T> = {
  [K in keyof T]: T[K] extends Record<string, unknown> ? DeepStringify<T[K]> : string;
};

export type NestedKeys<T, C extends string = "."> =
  T extends Record<string, unknown>
    ? {
        [K in Extract<keyof T, string>]: T[K] extends Record<string, unknown> ? `${K}${C}${NestedKeys<T[K], C>}` : K;
      }[Extract<keyof T, string>]
    : never;

export type Assert<T extends true> = T;

export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export type PathValue<T, K extends string> = K extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? PathValue<T[Head], Rest>
    : never
  : K extends keyof T
    ? T[K]
    : never;

export type ExtractDoubleBraceKeys<S extends string> = S extends `${string}{{${infer Param}}}${infer Rest}`
  ? Trim<Param> | ExtractDoubleBraceKeys<Rest>
  : never;

type Whitespace = " " | "\n" | "\t" | "\r";

type TrimLeft<S extends string> = S extends `${Whitespace}${infer Rest}` ? TrimLeft<Rest> : S;

type TrimRight<S extends string> = S extends `${infer Rest}${Whitespace}` ? TrimRight<Rest> : S;

type Trim<S extends string> = TrimLeft<TrimRight<S>>;

/**
 * 用户可见消息允许插值的参数值：只接受领域标量。
 *
 * 刻意排除对象与数组：Error、请求体、Cookie、Token、数据库记录、上游响应
 * 都不能作为插值参数，避免把内部或敏感内容渲染进用户消息。
 */
export type MessageParamValue = string | number | boolean;

/**
 * 宽松的运行时参数形状。
 *
 * 仅用于承载**已经过类型校验**的描述符容器与既有旧调用点；新建描述符必须走
 * `StrictParamsForTemplate` / `ParamsForKey` 的精确约束，不得直接使用本类型。
 * `null` / `undefined` 允许存在，但渲染时视为缺失参数并触发安全兜底。
 */
export type TranslationParams = Record<string, MessageParamValue | null | undefined>;

/**
 * 单个模板字符串的精确参数：占位符必须全部提供，且不接受无关键。
 *
 * 无占位符的模板得到 `undefined`，即**不允许**传入任何参数。
 */
export type StrictParamsForTemplate<S extends string> = [ExtractDoubleBraceKeys<S>] extends [never]
  ? undefined
  : { [K in ExtractDoubleBraceKeys<S>]: MessageParamValue };

/**
 * 单个消息 key 的精确参数。
 *
 * 按 key 分发（`K extends unknown`），因此联合 key 的结果是各成员约束的联合，
 * 不会因为「某个成员没有占位符」而把整体误判成无参。
 */
export type ParamsForKey<TMessages, K extends NestedKeys<TMessages>> = K extends unknown
  ? StrictParamsForTemplate<Extract<PathValue<TMessages, K>, string>>
  : never;

/** key 对参数的要求：`required` 必须传参、`forbidden` 不接受参数、`loose` 只能可选 */
export type MessageParamRequirement = "required" | "forbidden" | "loose";

/**
 * 按参数要求推导描述符工厂的剩余参数列表。
 *
 * 用条件元组实现「带占位符必须传参、无占位符不接受参数」的编译期约束，
 * 使工厂签名无法退化为「任意 key + 任意 params」。
 */
export type DescriptorRestArgs<
  TRequirement extends MessageParamRequirement,
  TParams,
  TFallback = string,
> = TRequirement extends "required"
  ? [params: TParams, fallback?: TFallback]
  : TRequirement extends "forbidden"
    ? [params?: undefined, fallback?: TFallback]
    : [params?: TParams, fallback?: TFallback];

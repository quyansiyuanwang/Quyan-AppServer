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

type ParamPrimitive = string | number | boolean | null | undefined;

export type TranslationParams = Record<string, ParamPrimitive>;

export type StrictParamsForTemplate<S extends string> = [ExtractDoubleBraceKeys<S>] extends [never]
  ? TranslationParams | undefined
  : Record<ExtractDoubleBraceKeys<S>, ParamPrimitive> & TranslationParams;

export type ParamsForKey<TMessages, K extends NestedKeys<TMessages>> =
  PathValue<TMessages, K> extends string
    ? StrictParamsForTemplate<PathValue<TMessages, K>>
    : TranslationParams | undefined;

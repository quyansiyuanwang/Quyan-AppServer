export const cast = <T>(x: any): T => x
export type Mutable<T> = { -readonly [K in keyof T]: T[K] }
export type DeepMutable<T> = { -readonly [K in keyof T]: DeepMutable<T[K]> }

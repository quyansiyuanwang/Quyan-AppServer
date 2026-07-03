export const cache = <T extends (...args: any[]) => any>(target: T): T => {
  const cacheMap = new WeakMap<any, any>();
  const cachedFunction = (...args: Parameters<T>): ReturnType<T> => {
    const key = args[0];
    if (cacheMap.has(key)) return cacheMap.get(key);

    const result = target.apply(null, args);
    cacheMap.set(key, result);
    return result;
  };
  return cachedFunction as T;
};

export const diff = <T>(
  oldList: T[],
  newList: T[],
  keyFn: (item: T) => any = (item) => item,
): { added: T[]; removed: T[] } => {
  const oldMap = new Map(oldList.map((item) => [keyFn(item), item]));
  const newMap = new Map(newList.map((item) => [keyFn(item), item]));

  const added = newList.filter((item) => !oldMap.has(keyFn(item)));
  const removed = oldList.filter((item) => !newMap.has(keyFn(item)));

  return { added, removed };
};

export const noUndefined = <T>(fn: () => T | undefined): T => {
  const result = fn();

  const recursiveCheck = (value: any): boolean => {
    if (value === undefined) return true;
    if (value && typeof value === "object") return Object.values(value).some(recursiveCheck);
    return false;
  };

  if (recursiveCheck(result) || result === undefined) throw new Error("Required value is undefined");
  return result;
};

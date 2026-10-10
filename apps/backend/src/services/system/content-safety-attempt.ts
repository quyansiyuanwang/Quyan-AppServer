import { AsyncLocalStorage } from "node:async_hooks";
export interface ContentSafetyAttempt {
  readonly values: Map<object, Map<string, Promise<unknown>>>;
}
export const contentSafetyAttemptContext = new AsyncLocalStorage<ContentSafetyAttempt>();
export function withContentSafetyAttempt<T>(work: () => T): T {
  const scope: ContentSafetyAttempt = { values: new Map() };
  try {
    const result = contentSafetyAttemptContext.run(scope, work);
    if (result instanceof Promise) return result.finally(() => scope.values.clear()) as T;
    scope.values.clear();
    return result;
  } catch (error) {
    scope.values.clear();
    throw error;
  }
}
export function resetContentSafetyAttempt() {
  contentSafetyAttemptContext.getStore()?.values.clear();
}
export function attemptValue<T>(owner: object, key: string, load: () => Promise<T>): Promise<T> {
  const scope = contentSafetyAttemptContext.getStore();
  if (!scope) return load();
  let values = scope.values.get(owner);
  if (!values) {
    values = new Map();
    scope.values.set(owner, values);
  }
  let pending = values.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = load();
    values.set(key, pending);
  }
  return pending;
}

/** Keep one policy snapshot across generator yields and release it on cancellation. */
export async function* withContentSafetyGenerator<T>(factory: () => AsyncGenerator<T>): AsyncGenerator<T> {
  const scope: ContentSafetyAttempt = { values: new Map() };
  const generator = contentSafetyAttemptContext.run(scope, factory);
  try {
    for (;;) {
      const result = await contentSafetyAttemptContext.run(scope, () => generator.next());
      if (result.done) return;
      yield result.value;
    }
  } finally {
    try {
      await contentSafetyAttemptContext.run(scope, () => generator.return(undefined as never));
    } finally {
      scope.values.clear();
    }
  }
}

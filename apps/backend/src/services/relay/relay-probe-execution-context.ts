import { AsyncLocalStorage } from "node:async_hooks";
const executionContext = new AsyncLocalStorage<() => Promise<void>>();
/** Every external probe side effect consults the worker's current authority, not a captured Allow boolean. */
export async function assertProbeRunExecution(): Promise<void> {
  await executionContext.getStore()?.();
}
export function withProbeRunExecution<T>(recheck: () => Promise<void>, operation: () => Promise<T>): Promise<T> {
  return executionContext.run(recheck, operation);
}

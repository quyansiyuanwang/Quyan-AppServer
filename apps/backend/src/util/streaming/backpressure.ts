import { aiAbortError, aiResourceContext } from "@/services/infrastructure/ai-resource.service";

export interface WritableResponse {
  write(chunk: Buffer | string): boolean;
  writableEnded?: boolean;
  destroyed?: boolean;
  once?: (event: string, listener: (...args: any[]) => void) => unknown;
  off?: (event: string, listener: (...args: any[]) => void) => unknown;
}

export async function writeWithBackpressure(
  response: WritableResponse,
  chunk: Buffer | string,
  signal = aiResourceContext.getStore()?.signal,
): Promise<void> {
  if (signal?.aborted || response.destroyed || response.writableEnded) throw aiAbortError();
  if (response.write(chunk) !== false) return;
  if (!response.once || !response.off) throw new Error("Backpressured response must expose its lifecycle events");
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      response.off!("drain", drained);
      response.off!("close", closed);
      response.off!("error", failed);
      signal?.removeEventListener("abort", closed);
    };
    const drained = () => {
      cleanup();
      resolve();
    };
    const closed = () => {
      cleanup();
      reject(aiAbortError());
    };
    const failed = (error: Error) => {
      cleanup();
      reject(error);
    };
    response.once!("drain", drained);
    response.once!("close", closed);
    response.once!("error", failed);
    signal?.addEventListener("abort", closed, { once: true });
    if (signal?.aborted || response.destroyed || response.writableEnded) closed();
  });
}

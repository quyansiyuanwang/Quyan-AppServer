import { type NextFunction, type Response } from "express";
import type { TypedRequest } from "@/types/express";
import {
  DistributedLockService,
  type DistributedLockHandle,
  type DistributedLockOptions,
} from "@/services/infrastructure/distributed-lock.service";

export interface DistributedLockMiddlewareOptions extends Omit<DistributedLockOptions, "ownerToken"> {
  keyBuilder: (request: TypedRequest) => string;
}

export function distributedLockMiddleware(
  options: DistributedLockMiddlewareOptions,
): (req: TypedRequest, res: Response, next: NextFunction) => Promise<void> {
  const lockService = DistributedLockService.getInstance();

  return async (req: TypedRequest, res: Response, next: NextFunction): Promise<void> => {
    let lockHandle: DistributedLockHandle | null = null;
    let released = false;

    const releaseLock = async (): Promise<void> => {
      if (released || !lockHandle) return;
      released = true;
      await lockService.release(lockHandle);
    };

    try {
      lockHandle = await lockService.acquire(options.keyBuilder(req), {
        ttlMs: options.ttlMs,
        acquireTimeoutMs: options.acquireTimeoutMs,
        retryIntervalMs: options.retryIntervalMs,
        failClosed: options.failClosed,
      });

      res.once("finish", () => {
        void releaseLock();
      });
      res.once("close", () => {
        void releaseLock();
      });

      next();
    } catch (error) {
      await releaseLock();
      next(error as Error);
    }
  };
}

import {
  DistributedLockService,
  type DistributedLockHandle,
  type DistributedLockOptions,
} from "@/services/infrastructure/distributed-lock.service";
import type { TypedRequest } from "@/types/express";
import { copyFunctionMetadata } from "@/util/decorator-metadata";

interface DistributedLockDecoratorOptions extends Omit<DistributedLockOptions, "ownerToken"> {
  keyBuilder: (request: TypedRequest, args: unknown[]) => string;
}

const findRequestArg = (args: unknown[]): TypedRequest | undefined => {
  return args.find((arg): arg is TypedRequest =>
    Boolean(
      arg &&
      typeof arg === "object" &&
      "headers" in (arg as Record<string, unknown>) &&
      "method" in (arg as Record<string, unknown>),
    ),
  );
};

export function DistributedLock(options: DistributedLockDecoratorOptions): MethodDecorator {
  return function (_target: object, _propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value;
    const lockService = DistributedLockService.getInstance();

    const wrappedMethod = async function (this: unknown, ...args: unknown[]) {
      const request = findRequestArg(args);
      if (!request) return await originalMethod.apply(this, args);

      let lockHandle: DistributedLockHandle | null = null;

      try {
        lockHandle = await lockService.acquire(options.keyBuilder(request, args), {
          ttlMs: options.ttlMs,
          acquireTimeoutMs: options.acquireTimeoutMs,
          retryIntervalMs: options.retryIntervalMs,
          failClosed: options.failClosed,
        });

        return await originalMethod.apply(this, args);
      } finally {
        if (lockHandle) await lockService.release(lockHandle);
      }
    };

    copyFunctionMetadata(originalMethod, wrappedMethod);
    descriptor.value = wrappedMethod;
    return descriptor;
  };
}

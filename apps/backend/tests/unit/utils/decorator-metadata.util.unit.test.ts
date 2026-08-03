import { describe, expect, it } from "vitest";
import { Middlewares, fetchMiddlewares } from "@tsoa/runtime";
import { CheckPermission, PermissionCheckMode } from "@/util/permission/permission-decorator";
import { LogRoute } from "@/util/logger-decorator";
import { Permission } from "@/constant/permission";

const middlewareA = (() => undefined) as any;
const middlewareB = (() => undefined) as any;

class PermissionWrappedController {
  @CheckPermission(Permission.ACCESSKEY_READ, PermissionCheckMode.ALL, "jwt")
  @Middlewares(middlewareA, middlewareB)
  public async list(): Promise<void> {
    return;
  }
}

class LoggerWrappedController {
  @LogRoute({ message: "metadata-test", logResponse: true })
  @Middlewares(middlewareA)
  public async stats(): Promise<void> {
    return;
  }
}

class CombinedWrappedController {
  @CheckPermission(Permission.ACCESSKEY_READ, PermissionCheckMode.ALL, "jwt")
  @LogRoute({ message: "combined-metadata-test" })
  @Middlewares(middlewareB)
  public async create(): Promise<void> {
    return;
  }
}

describe("decorator metadata preservation", () => {
  it("preserves @Middlewares metadata when wrapped by @CheckPermission", () => {
    const method = (PermissionWrappedController as any).prototype.list;
    const middlewares = fetchMiddlewares(method as any);

    expect(middlewares).toEqual([middlewareA, middlewareB]);
  });

  it("preserves @Middlewares metadata when wrapped by @LogRoute", () => {
    const method = (LoggerWrappedController as any).prototype.stats;
    const middlewares = fetchMiddlewares(method as any);

    expect(middlewares).toEqual([middlewareA]);
  });

  it("preserves @Middlewares metadata across multiple wrappers", () => {
    const method = (CombinedWrappedController as any).prototype.create;
    const middlewares = fetchMiddlewares(method as any);

    expect(middlewares).toEqual([middlewareB]);
  });
});

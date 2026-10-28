import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import type { TypedRequest } from "@/types/express";
import { setRequestContext } from "@/util/request-context";
import { RamService } from "@/services/users/ram.service";
import { UserHeartbeatService } from "@/services/users/user-heartbeat.service";
import { UserHeartbeatController } from "@/api/controllers/v1/users/user-heartbeat.controller";
import { iamAuthenticatedAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import { iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";

const originalMode = env.security.iamAuthorizationMode;
const heartbeat = UserHeartbeatService.getInstance();
let owner: string, actor: string, other: string;
type HeartbeatOperation = readonly [
  string,
  (controller: UserHeartbeatController, request: TypedRequest) => Promise<unknown>,
  "getRuntimeConfig" | "recordHeartbeat" | "stopHeartbeat",
];
const operations: readonly HeartbeatOperation[] = [
  [
    "GetHeartbeatConfig",
    (controller: UserHeartbeatController, _request: TypedRequest) => controller.getRuntimeConfig(),
    "getRuntimeConfig",
  ],
  [
    "SendHeartbeat",
    (controller: UserHeartbeatController, request: TypedRequest) => controller.sendHeartbeat(request),
    "recordHeartbeat",
  ],
  [
    "StopHeartbeat",
    (controller: UserHeartbeatController, request: TypedRequest) => controller.stopHeartbeat(request),
    "stopHeartbeat",
  ],
];
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "heartbeat-iam-" + randomUUID(),
          password: "fixture-only",
          accountOwnerId,
          parentUserId: accountOwnerId,
          userType: accountOwnerId ? "ram_user" : "root",
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  other = await user(owner);
  vi.spyOn(heartbeat, "getRuntimeConfig").mockResolvedValue({ intervalSeconds: 60, timeoutSeconds: 90 });
  vi.spyOn(heartbeat, "recordHeartbeat").mockResolvedValue({
    sessionId: "fixture-session",
    authSessionId: "fixture-auth-session",
    isNewSession: true,
    serverTime: "2026-10-09T00:00:00Z",
    lastHeartbeatAt: "2026-10-09T00:00:00Z",
  });
  vi.spyOn(heartbeat, "stopHeartbeat").mockResolvedValue({ closed: true, authSessionId: "fixture-auth-session" });
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
});

async function deny(operation: string, id = actor) {
  const service = RamService.getInstance();
  const policy = await service.createPolicy(owner, {
    name: "heartbeat-deny-" + randomUUID(),
    document: {
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:user:" + operation,
        Resource: "acs:quyan:*:" + owner + ":user/" + id,
      },
    },
  });
  await service.createAuthorization(owner, {
    principalType: "user",
    principalId: actor,
    policyId: policy.id,
    scopeType: "account",
  });
}
async function invoke(operation: HeartbeatOperation, subjectType = "sub_user") {
  return new AsyncResource("heartbeat-iam-fixture").runInAsyncScope(async () => {
    const request = {
      user: { userId: actor },
      authContext: { principalUserId: actor, accountOwnerId: owner, subjectType },
      body: { userId: other, accountId: "foreign" },
      params: { userId: other },
      headers: { "x-action": "quyan:user:StopHeartbeat", "x-user-id": other },
      ip: "127.0.0.1",
      secure: true,
    } as unknown as TypedRequest;
    setRequestContext(request);
    let error: unknown;
    await iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:user:" + operation[0],
      resourceKind: "single-resource",
      resource: iamAuthenticatedUserResourceResolver,
    })(request, {} as never, (value?: unknown) => {
      error = value;
    });
    if (error) throw error;
    return operation[1](new UserHeartbeatController(), request);
  });
}

describe("self-service heartbeat IAM", () => {
  it.each(operations)(
    "authorizes %s on the authenticated user instead of client-supplied IDs",
    async (...operation) => {
      await invoke(operation);
      expect(heartbeat[operation[2]]).toHaveBeenCalledTimes(1);
      if (operation[0] !== "GetHeartbeatConfig")
        expect(heartbeat[operation[2]]).toHaveBeenCalledWith(
          actor,
          expect.objectContaining({ user: { userId: actor } }),
        );
    },
  );
  it.each(operations)("blocks %s before its service when an exact self Deny matches", async (...operation) => {
    await deny(operation[0]);
    await expect(invoke(operation)).rejects.toMatchObject({ statusCode: 403 });
    expect(heartbeat[operation[2]]).not.toHaveBeenCalled();
  });
  it("does not apply a Deny on another user to the authenticated heartbeat resource", async () => {
    await deny("SendHeartbeat", other);
    await invoke(operations[1]);
    expect(heartbeat.recordHeartbeat).toHaveBeenCalledWith(actor, expect.anything());
  });
  it("retains self-only heartbeat access for AccessKey principals", async () => {
    await invoke(operations[1], "access_key");
    expect(heartbeat.recordHeartbeat).toHaveBeenCalledWith(actor, expect.anything());
    await deny("SendHeartbeat");
    await expect(invoke(operations[1], "access_key")).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("preserves the former authenticated endpoint in %s mode", async (mode) => {
    await deny("SendHeartbeat");
    env.security.iamAuthorizationMode = mode;
    await invoke(operations[1]);
    expect(heartbeat.recordHeartbeat).toHaveBeenCalledWith(actor, expect.anything());
  });
  it("fails closed for disabled authenticated identities", async () => {
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    await expect(invoke(operations[1])).rejects.toMatchObject({ statusCode: 403 });
    expect(heartbeat.recordHeartbeat).not.toHaveBeenCalled();
  });
});

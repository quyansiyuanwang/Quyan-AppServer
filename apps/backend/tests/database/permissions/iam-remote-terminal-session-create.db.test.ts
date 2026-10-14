import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RemoteTerminalService } from "@/services/remote-terminal/remote-terminal.service";
import { RemoteTerminalGatewayService } from "@/modules/remote-terminal/gateway/gateway.service";
import { RemoteTerminalDeviceIamService } from "@/services/remote-terminal/remote-terminal-device-iam.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { remoteTerminalDeviceArn } from "@/iam/resources/remote-terminal-resources";
import { RedisService } from "@/services/infrastructure/redis.service";
import { terminalSessionRedisKey } from "@/services/infrastructure/remote-terminal-session-projection";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, actorUpdatedAt: string;
const mode = env.security.iamAuthorizationMode,
  gateway = RemoteTerminalGatewayService.getInstance().getSessionGateway(),
  service = RemoteTerminalService.getInstance(),
  redis = RedisService.getInstance(),
  keys: string[] = [],
  sockets: EventEmitter[] = [],
  issued: string[] = [],
  browsers: EventEmitter[] = [];
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "terminal-issuance-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        parentUserId: accountOwnerId,
        userType: accountOwnerId ? "ram_user" : "root",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor, updatedAt: actorUpdatedAt },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "*" },
    secure: true,
    ip: "192.0.2.10",
  }) as unknown as TypedRequest;
async function device() {
  const entitlement = await prisma.remoteTerminalUserEntitlement.create({
    data: {
      userId: actor,
      name: "Fixture",
      startAt: new Date(Date.now() - 60_000),
      endAt: new Date(Date.now() + 3_600_000),
      deviceLimit: 4,
      terminalLimit: 2,
    },
  });
  const registration = await prisma.remoteTerminalEntitlementToken.create({
    data: { entitlementId: entitlement.id, token: randomUUID() },
  });
  const row = await prisma.remoteTerminalDeviceBinding.create({
    data: {
      userId: actor,
      entitlementId: entitlement.id,
      registrationTokenId: registration.id,
      deviceId: randomUUID(),
      fingerprint: randomUUID(),
      hostname: "fixture-host",
      platform: "linux",
      arch: "x64",
      heartbeatToken: randomUUID(),
      snapshot: { diagnostics: { availableShells: ["bash"] } },
      registeredAt: new Date(),
      lastSeenAt: new Date(),
      online: true,
    },
  });
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  socket.readyState = WebSocket.OPEN;
  socket.send = vi.fn();
  socket.close = vi.fn();
  sockets.push(socket);
  gateway.attachAgent(row.deviceId, socket as unknown as WebSocket);
  return row;
}
async function policy(deviceId: string, Effect = "Allow") {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: {
      Effect,
      Action: "quyan:remote_terminal:CreateSession",
      Resource: remoteTerminalDeviceArn(owner, actor, deviceId),
    },
  });
  const created = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "issuance-policy-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  return prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: "user",
      principalId: actor,
      policyId: created.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
async function pending(deviceId: string, status = "pending") {
  const row = {
    sessionId: randomUUID(),
    ownerUserId: actor,
    entitlementId: "fixture-entitlement",
    deviceId,
    mode: "shell",
    shellType: "bash",
    status,
    createdAt: "2026-10-14T00:00:00.000Z",
    workingDirectory: "PRIVATE-FIXTURE",
  };
  const key = terminalSessionRedisKey(row.sessionId);
  keys.push(key);
  expect(await redis.setWithResult(key, JSON.stringify(row), 60)).toBe(true);
  return row;
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  actorUpdatedAt = (
    await prisma.user.findUniqueOrThrow({ where: { id: actor }, select: { updateTime: true } })
  ).updateTime.toISOString();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const browser of browsers.splice(0)) browser.emit("close");
  for (const id of issued.splice(0)) await gateway.discardPendingSession(actor, id);
  for (const socket of sockets.splice(0)) socket.emit("close");
  if (keys.length) await redis.deleteMany(keys.splice(0));
  env.security.iamAuthorizationMode = mode;
});
async function connectPolicy(sessionId: string, Effect = "Allow") {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: {
      Effect,
      Action: "quyan:remote_terminal:ConnectSession",
      Resource: "acs:remote-terminal:*:" + owner + ":session/" + actor + "/" + sessionId,
    },
  });
  const created = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "connection-policy-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  return prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: "user",
      principalId: actor,
      policyId: created.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
function browserSocket() {
  const ws = new EventEmitter() as EventEmitter & {
    readyState: number;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  ws.readyState = WebSocket.OPEN;
  ws.send = vi.fn();
  ws.close = vi.fn().mockImplementation(() => {
    ws.readyState = WebSocket.CLOSED;
  });
  browsers.push(ws);
  return ws;
}
describe("native terminal capability issuance", () => {
  it("issues and persists one pending session only for an authorized selected device", async () => {
    const target = await device();
    await policy(target.deviceId);
    const result = await service.createSession(
      actor,
      { deviceId: target.deviceId, mode: "shell", shellType: "bash" },
      "ws://fixture",
      request(),
    );
    issued.push(result.sessionId);
    expect(result.deviceId).toBe(target.deviceId);
    expect(typeof result.browserToken).toBe("string");
    const raw = await redis.get(terminalSessionRedisKey(result.sessionId));
    expect(raw).not.toContain(result.browserToken);
    expect((await gateway.listSessionMetadata(actor)).map((row) => row.sessionId)).toEqual([result.sessionId]);
  });
  it("explicit Deny preserves old pending sessions without issuing anything", async () => {
    const target = await device(),
      old = await pending(target.deviceId);
    await policy(target.deviceId);
    await policy(target.deviceId, "Deny");
    await expect(
      service.createSession(
        actor,
        { deviceId: target.deviceId, mode: "shell", shellType: "bash" },
        "ws://fixture",
        request(),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await gateway.listSessionMetadata(actor)).map((row) => row.sessionId)).toEqual([old.sessionId]);
  });
  it("replaces only the selected device's pending session and preserves connected quota usage", async () => {
    const target = await device(),
      stale = await pending(target.deviceId),
      connected = await pending(target.deviceId, "connected");
    await policy(target.deviceId);
    const result = await service.createSession(
      actor,
      { deviceId: target.deviceId, mode: "shell", shellType: "bash" },
      "ws://fixture",
      request(),
    );
    issued.push(result.sessionId);
    expect(await redis.get(terminalSessionRedisKey(stale.sessionId))).toBeNull();
    expect(await redis.get(terminalSessionRedisKey(connected.sessionId))).not.toBeNull();
    expect(await gateway.listSessionMetadata(actor)).toHaveLength(2);
  });
  it("counts every active owned session even with no session-list permission", async () => {
    const target = await device();
    await pending("other-device", "connected");
    await pending("another-device", "connected");
    await policy(target.deviceId);
    await expect(
      service.createSession(
        actor,
        { deviceId: target.deviceId, mode: "shell", shellType: "bash" },
        "ws://fixture",
        request(),
      ),
    ).rejects.toThrow("Terminal quota exceeded");
    expect(await gateway.listSessionMetadata(actor)).toHaveLength(2);
  });
  it("compensates a pending issuance if authorization is revoked in the final guard", async () => {
    const target = await device(),
      authorization = await policy(target.deviceId),
      create = gateway.createSession.bind(gateway);
    vi.spyOn(gateway, "createSession").mockImplementationOnce(async (...args) => {
      const result = await create(...args);
      issued.push(result.sessionId);
      await prisma.ramAuthorization.update({ where: { id: authorization.id }, data: { status: 0 } });
      return result;
    });
    await expect(
      service.createSession(
        actor,
        { deviceId: target.deviceId, mode: "shell", shellType: "bash" },
        "ws://fixture",
        request(),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await gateway.listSessionMetadata(actor)).toEqual([]);
  });
  it("rejects a native device-create grant to another device", async () => {
    const target = await device();
    await policy(randomUUID());
    await expect(
      service.createSession(
        actor,
        { deviceId: target.deviceId, mode: "shell", shellType: "bash" },
        "ws://fixture",
        request(),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await gateway.listSessionMetadata(actor)).toEqual([]);
  });
  it("does not infer terminal execution from pending-session creation permission", async () => {
    const target = await device();
    await policy(target.deviceId);
    const result = await service.createSession(
      actor,
      { deviceId: target.deviceId, mode: "shell", shellType: "bash" },
      "ws://fixture",
      request(),
    );
    issued.push(result.sessionId);
    const browser = browserSocket(),
      agent = sockets.at(-1) as EventEmitter & { send: ReturnType<typeof vi.fn> };
    agent.send.mockClear();
    await expect(
      gateway.attachAuthorizedBrowser(result.sessionId, result.browserToken, browser as unknown as WebSocket, {
        "acs:SecureTransport": true,
        "acs:SourceIp": "192.0.2.10",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(agent.send.mock.calls.some(([raw]) => JSON.parse(raw).type === "session-start")).toBe(false);
  });
  it("revokes real browser output after a connected session policy is disabled", async () => {
    const target = await device();
    await policy(target.deviceId);
    const result = await service.createSession(
      actor,
      { deviceId: target.deviceId, mode: "shell", shellType: "bash" },
      "ws://fixture",
      request(),
    );
    issued.push(result.sessionId);
    const authorization = await connectPolicy(result.sessionId),
      browser = browserSocket(),
      agent = sockets.at(-1) as EventEmitter & { send: ReturnType<typeof vi.fn> };
    await gateway.attachAuthorizedBrowser(result.sessionId, result.browserToken, browser as unknown as WebSocket, {
      "acs:SecureTransport": true,
      "acs:SourceIp": "192.0.2.10",
    });
    expect(agent.send.mock.calls.some(([raw]) => JSON.parse(raw).type === "session-start")).toBe(true);
    browser.send.mockClear();
    await prisma.ramAuthorization.update({ where: { id: authorization.id }, data: { status: 0 } });
    agent.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "session-output",
          sessionId: result.sessionId,
          stream: "stdout",
          data: "DENIED-OUTPUT",
        }),
      ),
    );
    await vi.waitFor(() => expect(browser.close).toHaveBeenCalledWith(1008, "IAM session authorization failed."), {
      timeout: 5_000,
    });
    expect(browser.send.mock.calls.some(([raw]) => JSON.parse(raw).data === "DENIED-OUTPUT")).toBe(false);
  });
  it("uses the same device guard to reject an expired entitlement", async () => {
    const target = await device();
    await policy(target.deviceId);
    await prisma.remoteTerminalUserEntitlement.update({
      where: { id: target.entitlementId },
      data: { endAt: new Date(Date.now() - 1_000) },
    });
    await expect(
      RemoteTerminalDeviceIamService.getInstance().withDevice(
        actor,
        target.deviceId,
        "quyan:remote_terminal:CreateSession",
        request(),
        vi.fn(),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

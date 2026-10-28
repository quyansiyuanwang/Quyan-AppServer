import { randomUUID, createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { AgentRepository } from "@/store/agent/agent.repository";
const repository = AgentRepository.getInstance();
let owner: string, actor: string, other: string, foreign: string, agentId: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "runtime-fixture-" + randomUUID(),
        password: "fixture-only",
        permissionAdds: [],
        permissionRemoves: [],
        accountOwnerId,
      },
    })
  ).id;
const machine = async (userId = actor) => {
  const registrationHash = createHash("sha256").update(randomUUID()).digest("hex");
  const row = await repository.createMachine({ userId, name: "fixture", registrationHash });
  return { row, registrationHash };
};
beforeEach(async () => {
  agentId = "fixture-agent-" + randomUUID();
  owner = await user();
  actor = await user(owner);
  other = await user(owner);
  foreign = await user();
});

describe("Agent runtime database identity and fencing", () => {
  it("derives the account from active machine ownership without returning credentials", async () => {
    const { row, registrationHash } = await machine();
    const identity = (await repository.connectRuntimeMachine(registrationHash, agentId, {}))!;
    expect(identity).toMatchObject({ id: row.id, userId: actor, accountOwnerId: owner, agentId: agentId });
    expect(identity).not.toHaveProperty("registrationHash");
    expect(await repository.isRuntimeConnectionActive(identity)).toBe(true);
    expect(await repository.connectRuntimeMachine("0".repeat(64), "invalid", {})).toBeNull();
    const root = await machine(owner);
    expect(await repository.connectRuntimeMachine(root.registrationHash, "root-agent", {})).toMatchObject({
      accountOwnerId: owner,
    });
  });
  it("fences replaced connections even if they use the same agent ID", async () => {
    const { registrationHash } = await machine();
    const first = (await repository.connectRuntimeMachine(registrationHash, agentId, {}))!;
    const next = (await repository.connectRuntimeMachine(registrationHash, agentId, {}))!;
    expect(next.updateTime.getTime()).toBeGreaterThan(first.updateTime.getTime());
    expect(await repository.isRuntimeConnectionActive(first)).toBe(false);
    expect(await repository.markMachineHeartbeat(first)).toBeNull();
    expect((await repository.markMachineOffline(first)).count).toBe(0);
    expect(await repository.isRuntimeConnectionActive(next)).toBe(true);
    const heartbeat = (await repository.markMachineHeartbeat(next, { docker: true }))!;
    expect(await repository.isRuntimeConnectionActive(next)).toBe(false);
    expect(await repository.isRuntimeConnectionActive(heartbeat)).toBe(true);
    expect((await repository.markMachineOffline(heartbeat)).count).toBe(1);
    expect(await repository.isRuntimeConnectionActive(heartbeat)).toBe(false);
  });
  it("does not let a machine claim another machine's agent ID", async () => {
    const first = await machine(),
      second = await machine(other);
    const identity = (await repository.connectRuntimeMachine(first.registrationHash, agentId, {}))!;
    await expect(repository.connectRuntimeMachine(second.registrationHash, agentId, {})).rejects.toMatchObject({
      code: "P2002",
    });
    expect(await repository.isRuntimeConnectionActive(identity)).toBe(true);
    expect((await repository.findMachineForUser(second.row.id, other))?.agentId).toBeNull();
  });
  it("rejects revoked machines and cannot revive them through heartbeat or reconnect", async () => {
    const { row, registrationHash } = await machine();
    const identity = (await repository.connectRuntimeMachine(registrationHash, agentId, {}))!;
    await repository.deleteMachineTarget((await repository.findMachineTarget(row.id, actor, owner))!, owner);
    expect(await repository.isRuntimeConnectionActive(identity)).toBe(false);
    expect(await repository.markMachineHeartbeat(identity)).toBeNull();
    expect((await repository.markMachineOffline(identity)).count).toBe(0);
    expect(await repository.connectRuntimeMachine(registrationHash, agentId, {})).toBeNull();
    expect((await prisma.agentRuntimeMachine.findUnique({ where: { id: row.id } }))?.runtimeStatus).toBe("revoked");
  });
  it("rejects disabled users, disabled accounts and changed account ownership", async () => {
    const { registrationHash } = await machine();
    const identity = (await repository.connectRuntimeMachine(registrationHash, agentId, {}))!;
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    expect(await repository.connectRuntimeMachine(registrationHash, agentId, {})).toBeNull();
    expect(await repository.isRuntimeConnectionActive(identity)).toBe(false);
    await prisma.user.update({ where: { id: actor }, data: { status: 1 } });
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    expect(await repository.connectRuntimeMachine(registrationHash, agentId, {})).toBeNull();
    expect(await repository.markMachineHeartbeat(identity)).toBeNull();
    await prisma.user.update({ where: { id: owner }, data: { status: 1 } });
    await prisma.user.update({ where: { id: actor }, data: { accountOwnerId: foreign } });
    expect(await repository.isRuntimeConnectionActive(identity)).toBe(false);
    expect(await repository.markMachineHeartbeat(identity)).toBeNull();
  });
  it("marks ready only the provisioned workspace belonging to the authenticated machine and user", async () => {
    const first = await machine(),
      second = await machine(other);
    const identity = (await repository.connectRuntimeMachine(first.registrationHash, agentId, {}))!;
    const create = (userId: string, machineId: string, runtimeHandle: string | null) =>
      prisma.agentWorkspace.create({
        data: {
          userId,
          machineId,
          name: "fixture",
          runtimeAgentId: agentId,
          runtimeStatus: "provisioning",
          runtimeHandle,
        },
      });
    const allowed = await create(actor, first.row.id, "handle");
    const wrongUser = await create(other, first.row.id, "handle");
    const wrongMachine = await create(actor, second.row.id, "handle");
    const waiting = await create(actor, first.row.id, null);
    expect((await repository.markRuntimeAgentReady(identity)).count).toBe(1);
    expect((await prisma.agentWorkspace.findUnique({ where: { id: allowed.id } }))?.runtimeStatus).toBe("ready");
    for (const row of [wrongUser, wrongMachine, waiting])
      expect((await prisma.agentWorkspace.findUnique({ where: { id: row.id } }))?.runtimeStatus).toBe("provisioning");
    await repository.markMachineHeartbeat(identity);
    expect((await repository.markRuntimeAgentReady(identity)).count).toBe(0);
  });
});

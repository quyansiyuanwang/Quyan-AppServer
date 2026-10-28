import { randomUUID, createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { AgentRepository } from "@/store/agent/agent.repository";
import { AgentMachineIamService } from "@/services/agent/agent-machine-iam.service";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { agentMachineArn } from "@/iam/resources/agent-resources";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, other: string, foreign: string;
const repository = AgentRepository.getInstance(),
  groups = RamResourceGroupRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "machine-fixture-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
beforeEach(async () => {
  owner = await user();
  actor = await user(owner);
  other = await user(owner);
  foreign = await user();
});
const machine = (userId = actor) =>
  repository.createMachine({
    userId,
    name: "fixture",
    registrationHash: createHash("sha256").update(randomUUID()).digest("hex"),
  });
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
  }) as unknown as TypedRequest;
describe("Agent machine storage authorization boundaries", () => {
  it("never loads registration hashes in public or metadata reads", async () => {
    const row = await machine();
    await machine(other);
    await machine(foreign);
    expect(row).not.toHaveProperty("registrationHash");
    const targets = await repository.scanMachineTargets(actor, owner);
    expect(targets).toHaveLength(1);
    expect(targets[0]).not.toHaveProperty("capabilities");
    expect(targets[0]).not.toHaveProperty("registrationHash");
    expect((await repository.readMachineTargets(actor, owner, targets))[0]).not.toHaveProperty("registrationHash");
    expect((await repository.listMachines(actor))[0]).not.toHaveProperty("registrationHash");
    expect(await repository.findMachineTarget(row.id, other, owner)).toBeNull();
    expect(await repository.scanMachineTargets(actor, foreign)).toEqual([]);
  });
  it("rejects cross-account creation and stale/reassigned machine deletion", async () => {
    await expect(
      repository.createMachine(
        { userId: actor, name: "fixture", registrationHash: createHash("sha256").update(randomUUID()).digest("hex") },
        foreign,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const row = await machine(),
      target = (await repository.findMachineTarget(row.id, actor, owner))!;
    await prisma.agentRuntimeMachine.update({
      where: { id: row.id },
      data: { updateTime: new Date(target.updateTime.getTime() + 1000) },
    });
    expect(await repository.readMachineTargets(actor, owner, [target])).toEqual([]);
    await expect(repository.deleteMachineTarget(target, owner)).rejects.toMatchObject({ statusCode: 403 });
    const latest = (await repository.findMachineTarget(row.id, actor, owner))!;
    await expect(repository.deleteMachineTarget(latest, foreign)).rejects.toMatchObject({ statusCode: 403 });
    await repository.deleteMachineTarget(latest, owner);
    expect(await repository.findMachineTarget(row.id, actor, owner)).toBeNull();
    expect((await prisma.agentRuntimeMachine.findUnique({ where: { id: row.id } }))?.runtimeStatus).toBe("revoked");
  });
  it("checks precise group ownership and active user/machine membership", async () => {
    const row = await machine();
    expect(await groups.resourceExistsInAccount(agentMachineArn(owner, actor, row.id), owner)).toBe(true);
    expect(await groups.resourceExistsInAccount(agentMachineArn(owner, actor, row.id.toUpperCase()), owner)).toBe(
      false,
    );
    expect(await groups.resourceExistsInAccount(agentMachineArn(foreign, actor, row.id), foreign)).toBe(false);
    expect(await groups.resourceExistsInAccount(agentMachineArn(owner, other, row.id), owner)).toBe(false);
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    expect(await groups.resourceExistsInAccount(agentMachineArn(owner, actor, row.id), owner)).toBe(false);
  });
  it("enforces actual policy Deny and binding revocation before hydration", async () => {
    const allowed = await machine(),
      denied = await machine();
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: [
        {
          Effect: "Allow",
          Action: "quyan:agent:ListMachines",
          Resource: "acs:agent:*:" + owner + ":machine/" + actor + "/*",
        },
        { Effect: "Deny", Action: "quyan:agent:ListMachines", Resource: agentMachineArn(owner, actor, denied.id) },
      ],
    });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "machine-policy-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
    const binding = await prisma.ramAuthorization.create({
      data: {
        accountOwnerId: owner,
        principalType: "user",
        principalId: actor,
        policyId: policy.id,
        scopeType: "account",
        scopeKey: "account",
        createdBy: owner,
      },
    });
    expect((await AgentMachineIamService.getInstance().list(actor, request())).map((row) => row.id)).toEqual([
      allowed.id,
    ]);
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
    expect(await AgentMachineIamService.getInstance().list(actor, request())).toEqual([]);
  });
});

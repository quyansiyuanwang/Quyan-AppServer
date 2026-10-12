import { randomUUID, createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { AgentRepository } from "@/store/agent/agent.repository";
import { AgentWorkspaceIamService } from "@/services/agent/agent-workspace-iam.service";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { agentWorkspaceArn } from "@/iam/resources/agent-resources";
import type { TypedRequest } from "@/types/express";
const repository = AgentRepository.getInstance(),
  groups = RamResourceGroupRepository.getInstance();
let owner: string, actor: string, other: string, foreign: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "workspace-fixture-" + randomUUID(),
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
    name: "private-machine",
    registrationHash: createHash("sha256").update(randomUUID()).digest("hex"),
  });
const workspace = (userId = actor, machineId?: string) =>
  repository.createWorkspace({
    userId,
    name: "fixture",
    machineId,
    policy: { allowedCommands: ["private"] },
    limits: {},
  });
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
  }) as unknown as TypedRequest;
describe("Agent workspace storage and IAM boundaries", () => {
  it("scans metadata before hydration, isolates accounts and excludes machine credentials and runtime handles", async () => {
    const selectedMachine = await machine();
    const selected = await workspace(actor, selectedMachine.id);
    await workspace(other);
    await workspace(foreign);
    const targets = await repository.scanWorkspaceTargets(actor, owner);
    expect(targets).toHaveLength(1);
    expect(targets[0]).not.toHaveProperty("policy");
    expect(targets[0]).not.toHaveProperty("limits");
    expect(await repository.scanWorkspaceTargets(actor, foreign)).toEqual([]);
    const rows = await repository.readWorkspaceTargets(actor, owner, targets);
    expect(rows[0]).not.toHaveProperty("machine");
    expect(rows[0]).not.toHaveProperty("runtimeHandle");
    const legacy = await repository.findWorkspaces(actor);
    expect(legacy[0].machine).not.toHaveProperty("registrationHash");
    expect(await repository.findWorkspaceById(selected.id)).not.toHaveProperty("runtimeHandle");
    expect((await repository.readMachineSummaries(actor, owner, [selectedMachine.id]))[0]).not.toHaveProperty(
      "registrationHash",
    );
    expect(await repository.readMachineSummaries(other, owner, [selectedMachine.id])).toEqual([]);
    await prisma.agentWorkspace.update({
      where: { id: selected.id },
      data: { updateTime: new Date(targets[0].updateTime.getTime() + 1000) },
    });
    expect(await repository.readWorkspaceTargets(actor, owner, targets)).toEqual([]);
  });
  it("checks trusted account and the selected machine snapshot in the creation transaction", async () => {
    const selected = await machine();
    const target = (await repository.findMachineTarget(selected.id, actor, owner))!;
    const data = { userId: actor, name: "fixture", machineId: selected.id, policy: {}, limits: {} };
    await expect(repository.createWorkspace(data, foreign, target)).rejects.toMatchObject({ statusCode: 403 });
    await expect(repository.createWorkspace(data, owner)).rejects.toMatchObject({ statusCode: 403 });
    const created = await repository.createWorkspace(data, owner, target);
    expect(created.machineId).toBe(selected.id);
    const updated = await repository.updateWorkspaceTarget(created, owner, {
      runtimeStatus: "ready",
      runtimeHandle: "private-runtime-handle",
    });
    expect(updated.runtimeStatus).toBe("ready");
    expect(updated).not.toHaveProperty("runtimeHandle");
    await expect(repository.updateWorkspaceTarget(created, owner, { runtimeStatus: "failed" })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(repository.updateWorkspaceTarget(updated, foreign, { runtimeStatus: "failed" })).rejects.toMatchObject(
      { statusCode: 403 },
    );
    await prisma.agentRuntimeMachine.update({ where: { id: selected.id }, data: { status: -1 } });
    await expect(repository.createWorkspace(data, owner, target)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(
      repository.createWorkspace({ userId: actor, name: "fixture", policy: {}, limits: {} }, owner),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fences concurrent deletion and provisioning and preserves failed cleanup for retry", async () => {
    const row = await workspace();
    const target = (await repository.findWorkspaceTarget(row.id, actor, owner))!;
    expect(target).not.toHaveProperty("runtimeHandle");
    await expect(repository.claimWorkspaceDeletion(target, foreign)).rejects.toMatchObject({ statusCode: 403 });
    const claim = await repository.claimWorkspaceDeletion(target, owner);
    await expect(repository.claimWorkspaceDeletion(target, owner)).rejects.toMatchObject({ statusCode: 403 });
    await expect(repository.claimWorkspaceDeletion(claim, owner)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      repository.updateWorkspaceTarget(target, owner, { runtimeStatus: "ready", runtimeHandle: "late-handle" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await repository.readWorkspaceRuntimeTarget(target, owner)).toBeNull();
    expect((await repository.releaseWorkspaceDeletion(target, owner, false)).count).toBe(0);
    expect((await repository.releaseWorkspaceDeletion(claim, owner, true)).count).toBe(1);
    const retry = (await repository.findWorkspaceTarget(row.id, actor, owner))!;
    expect((await repository.readWorkspaceRuntimeTarget(retry, owner))?.runtimeHandle).toBeNull();
    const next = await repository.claimWorkspaceDeletion(retry, owner);
    await repository.updateWorkspaceTarget(next, owner, { status: -1, runtimeStatus: "stopped", runtimeHandle: null });
    expect(await repository.findWorkspaceTarget(row.id, actor, owner)).toBeNull();
    expect((await repository.releaseWorkspaceDeletion(next, owner, false)).count).toBe(0);
  });
  it("verifies exact ownership and status before resource group membership", async () => {
    const row = await workspace();
    expect(await groups.resourceExistsInAccount(agentWorkspaceArn(owner, actor, row.id), owner)).toBe(true);
    expect(await groups.resourceExistsInAccount(agentWorkspaceArn(owner, other, row.id), owner)).toBe(false);
    expect(await groups.resourceExistsInAccount(agentWorkspaceArn(foreign, actor, row.id), foreign)).toBe(false);
    expect(await groups.resourceExistsInAccount(agentWorkspaceArn(owner, actor, row.id.toUpperCase()), owner)).toBe(
      false,
    );
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    expect(await groups.resourceExistsInAccount(agentWorkspaceArn(owner, actor, row.id), owner)).toBe(false);
  });
  it("honors actual workspace Deny, independent machine visibility and live authorization revocation", async () => {
    const selectedMachine = await machine(),
      allowed = await workspace(actor, selectedMachine.id),
      denied = await workspace();
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: [
        {
          Effect: "Allow",
          Action: "quyan:agent:ListWorkspaces",
          Resource: "acs:agent:*:" + owner + ":workspace/" + actor + "/*",
        },
        { Effect: "Deny", Action: "quyan:agent:ListWorkspaces", Resource: agentWorkspaceArn(owner, actor, denied.id) },
      ],
    });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "workspace-policy-" + randomUUID(),
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
    const rows = await AgentWorkspaceIamService.getInstance().list(actor, request());
    expect(rows.map((row) => row.id)).toEqual([allowed.id]);
    expect(rows[0].machine).toBeNull();
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
    expect(await AgentWorkspaceIamService.getInstance().list(actor, request())).toEqual([]);
  });
});

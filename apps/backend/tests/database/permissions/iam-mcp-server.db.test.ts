import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { AgentRepository } from "@/store/agent/agent.repository";
import { McpServerIamService } from "@/services/agent/mcp-server-iam.service";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { mcpServerArn } from "@/iam/resources/mcp-resources";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, other: string, foreign: string;
const repository = AgentRepository.getInstance(),
  groups = RamResourceGroupRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "mcp-fixture-" + randomUUID(),
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
const server = (name = "fixture", userId = actor) =>
  repository.createMcpServer({
    userId,
    name,
    transport: "sse",
    endpoint: "https://fixture.invalid/mcp",
    toolAllowlist: [],
    credential: { create: { ciphertext: "fixture-ciphertext", iv: "fixture-iv", authTag: "fixture-tag" } },
  });
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
  }) as unknown as TypedRequest;
describe("MCP storage projection and account scopes", () => {
  it("does not load credential ciphertext in either legacy or scoped configuration reads", async () => {
    const row = await server();
    await server("other", other);
    await server("foreign", foreign);
    expect(row.credential).toEqual({ id: expect.any(String) });
    const targets = await repository.scanMcpTargets(actor, owner);
    expect(targets).toHaveLength(1);
    expect(targets[0]).not.toHaveProperty("endpoint");
    expect(targets[0]).not.toHaveProperty("credential");
    const rows = await repository.readMcpTargets(actor, owner, targets);
    expect(rows[0].credential).toEqual({ id: expect.any(String) });
    expect((await repository.findMcpServers(actor))[0].credential).toEqual({ id: expect.any(String) });
    expect(await repository.scanMcpTargets(actor, foreign)).toEqual([]);
    await prisma.mcpServer.update({
      where: { id: row.id },
      data: { updateTime: new Date(targets[0].updateTime.getTime() + 1000) },
    });
    expect(await repository.readMcpTargets(actor, owner, targets)).toEqual([]);
  });
  it("enforces current user-account membership at create time", async () => {
    await expect(
      repository.createMcpServer({ userId: actor, name: "fixture", transport: "sse", toolAllowlist: [] }, foreign),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    await expect(
      repository.createMcpServer({ userId: actor, name: "fixture", transport: "sse", toolAllowlist: [] }, owner),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("checks exact group ownership and removes disabled or deleted resources", async () => {
    const row = await server();
    expect(await groups.resourceExistsInAccount(mcpServerArn(owner, actor, row.id), owner)).toBe(true);
    expect(await groups.resourceExistsInAccount(mcpServerArn(owner, other, row.id), owner)).toBe(false);
    expect(await groups.resourceExistsInAccount(mcpServerArn(foreign, actor, row.id), foreign)).toBe(false);
    expect(await groups.resourceExistsInAccount(mcpServerArn(owner, actor, row.id.toUpperCase()), owner)).toBe(false);
    await prisma.mcpServer.update({ where: { id: row.id }, data: { status: -1 } });
    expect(await groups.resourceExistsInAccount(mcpServerArn(owner, actor, row.id), owner)).toBe(false);
  });
  it("preserves database name collation and deterministic same-name cursors", async () => {
    const a = await server("a"),
      b = await server("B"),
      c = await server("c");
    const rows = await repository.scanMcpTargets(actor, owner);
    expect(rows.map((row) => row.id)).toEqual([a.id, b.id, c.id]);
    expect((await repository.scanMcpTargets(actor, owner, rows[0])).map((row) => row.id)).toEqual([b.id, c.id]);
  });
  it("uses real identity policies and global Deny before loading configuration", async () => {
    const allowed = await server("a"),
      denied = await server("b");
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: [
        {
          Effect: "Allow",
          Action: "quyan:mcp:ListServers",
          Resource: "acs:mcp:*:" + owner + ":server/" + actor + "/*",
        },
        { Effect: "Deny", Action: "quyan:mcp:ListServers", Resource: mcpServerArn(owner, actor, denied.id) },
      ],
    });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "mcp-policy-" + randomUUID(),
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
    expect((await McpServerIamService.getInstance().list(actor, request())).map((row) => row.id)).toEqual([allowed.id]);
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
    expect(await McpServerIamService.getInstance().list(actor, request())).toEqual([]);
  });
});

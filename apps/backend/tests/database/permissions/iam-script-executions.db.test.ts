import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { UserScriptRepository } from "@/store/user-script.repository";
import { UserScriptExecutionRepository } from "@/store/user-script-execution.repository";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { userScriptExecutionArn } from "@/iam/resources/script-resources";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { UserScriptExecutionIamService } from "@/services/user-script/user-script-execution-iam.service";
import { userScriptArn } from "@/iam/resources/script-resources";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, foreign: string;
const scripts = UserScriptRepository.getInstance(),
  executions = UserScriptExecutionRepository.getInstance(),
  groups = RamResourceGroupRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "execution-fixture-" + randomUUID(),
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
  foreign = await user();
});
const params = (scriptId?: string) => ({
  userId: actor,
  scriptId,
  scriptName: "fixture",
  contentSnapshot: "private snapshot",
  output: "private output",
  durationMs: 1,
});
const script = (userId = actor) => scripts.create({ userId, name: "fixture", content: "private" });
describe("script execution association and history storage", () => {
  it("evaluates real identity policies and global Deny for script and execution resources", async () => {
    const own = await script();
    const linked = await executions.create(params(own.id), owner);
    const denied = await executions.create(params(), owner);
    const allowed = await executions.create(params(), owner);
    const action = "quyan:script:ListExecutions";
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: [
        {
          Effect: "Allow",
          Action: action,
          Resource: [userScriptArn(owner, actor, own.id), "acs:script:*:" + owner + ":execution/" + actor + "/*"],
        },
        { Effect: "Deny", Action: action, Resource: userScriptExecutionArn(owner, actor, denied.id) },
      ],
    });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "history-fixture-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
    const authorization = await prisma.ramAuthorization.create({
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
    const request = {
      user: { userId: actor },
      authContext: { principalUserId: actor, accountOwnerId: owner },
      headers: {},
    } as unknown as TypedRequest;
    const iam = UserScriptExecutionIamService.getInstance();
    expect((await iam.list(actor, request)).map((row) => row.id).sort()).toEqual([linked.id, allowed.id].sort());
    await prisma.ramAuthorization.update({ where: { id: authorization.id }, data: { status: -1 } });
    expect(await iam.list(actor, request)).toEqual([]);
  });
  it("rejects foreign-user deleted and case-aliased script associations even without IAM mode", async () => {
    const other = await script(foreign),
      own = await script();
    await expect(executions.create(params(other.id))).rejects.toMatchObject({ statusCode: 403 });
    await expect(executions.create(params(own.id.toUpperCase()))).rejects.toMatchObject({ statusCode: 403 });
    await scripts.delete(own.id);
    await expect(executions.create(params(own.id))).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.userScriptExecution.count({ where: { userId: actor } })).toBe(0);
  });
  it("checks trusted account and script version again in the save transaction", async () => {
    const own = await script(),
      target = await scripts.findTarget(own.id, actor, owner);
    await expect(executions.create(params(own.id), foreign, target!)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.userScript.update({
      where: { id: own.id },
      data: { updateTime: new Date(target!.updateTime.getTime() + 1000) },
    });
    await expect(executions.create(params(own.id), owner, target!)).rejects.toMatchObject({ statusCode: 403 });
    expect(await executions.create(params(), owner)).toMatchObject({ userId: actor, scriptId: null });
  });
  it("reads metadata without snapshots and preserves owned history after script deletion", async () => {
    const own = await script();
    const linked = await executions.create(params(own.id), owner);
    const unlinked = await executions.create(params(), owner);
    await scripts.delete(own.id);
    const targets = await executions.scanTargets(actor, owner);
    expect(targets).toHaveLength(2);
    expect(targets[0]).not.toHaveProperty("contentSnapshot");
    expect(targets[0]).not.toHaveProperty("output");
    expect((await executions.readTargets(actor, owner, targets)).map((row) => row.id).sort()).toEqual(
      [linked.id, unlinked.id].sort(),
    );
    expect(await executions.scanTargets(actor, foreign)).toEqual([]);
  });
  it("excludes historical forged associations from scan hydration and resource groups", async () => {
    const other = await script(foreign);
    const forged = await prisma.userScriptExecution.create({ data: params(other.id) });
    expect(await executions.scanTargets(actor, owner)).toEqual([]);
    expect(await executions.readTargets(actor, owner, [forged])).toEqual([]);
    expect(await groups.resourceExistsInAccount(userScriptExecutionArn(owner, actor, forged.id), owner)).toBe(false);
    const unlinked = await executions.create(params());
    expect(await groups.resourceExistsInAccount(userScriptExecutionArn(owner, actor, unlinked.id), owner)).toBe(true);
    expect(
      await groups.resourceExistsInAccount(userScriptExecutionArn(owner, actor, unlinked.id.toUpperCase()), owner),
    ).toBe(false);
    expect(await groups.resourceExistsInAccount(userScriptExecutionArn(foreign, actor, unlinked.id), foreign)).toBe(
      false,
    );
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    expect(await groups.resourceExistsInAccount(userScriptExecutionArn(owner, actor, unlinked.id), owner)).toBe(false);
  });
});

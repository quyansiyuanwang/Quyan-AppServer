import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { UserScriptRepository } from "@/store/user-script.repository";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { userScriptArn } from "@/iam/resources/script-resources";

let owner: string, actor: string, foreign: string;
const repository = UserScriptRepository.getInstance(),
  groups = RamResourceGroupRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "script-fixture-" + randomUUID(),
        password: "fixture-only",
        permissionAdds: [],
        permissionRemoves: [],
        accountOwnerId,
      },
    })
  ).id;
beforeEach(async () => {
  owner = await user();
  actor = await user(owner);
  foreign = await user();
});
const script = (userId = actor) => repository.create({ userId, name: "fixture", content: "private-body" });

describe("script account boundaries and authorization snapshots", () => {
  it("scans only active account-owned metadata and hydrates exact snapshots", async () => {
    const row = await script();
    await script(foreign);
    expect(await repository.scanTargets(actor, foreign)).toEqual([]);
    const targets = await repository.scanTargets(actor, owner);
    expect(targets).toHaveLength(1);
    expect(targets[0]).not.toHaveProperty("content");
    expect((await repository.readTargets(actor, owner, targets))[0].id).toBe(row.id);
    await prisma.userScript.update({
      where: { id: row.id },
      data: { updateTime: new Date(targets[0].updateTime.getTime() + 1000), content: "changed" },
    });
    expect(await repository.readTargets(actor, owner, targets)).toEqual([]);
    await expect(repository.updateTarget(targets[0], owner, { content: "overwrite" })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(repository.deleteTarget(targets[0], owner)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("checks script membership using exact user/child identifiers and active account ownership", async () => {
    const row = await script();
    expect(await groups.resourceExistsInAccount(userScriptArn(owner, actor, row.id), owner)).toBe(true);
    expect(await groups.resourceExistsInAccount(userScriptArn(foreign, actor, row.id), foreign)).toBe(false);
    expect(await groups.resourceExistsInAccount(userScriptArn(owner, actor, row.id.toUpperCase()), owner)).toBe(false);
    expect(await groups.resourceExistsInAccount(userScriptArn(owner, foreign, row.id), owner)).toBe(false);
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    expect(await groups.resourceExistsInAccount(userScriptArn(owner, actor, row.id), owner)).toBe(false);
  });
  it("enforces active owner and account predicates on creation mutation and deletion", async () => {
    await expect(
      repository.createInAccount({ userId: actor, name: "fixture", content: "private" }, foreign),
    ).rejects.toMatchObject({ statusCode: 403 });
    const row = await script();
    const target = await repository.findTarget(row.id, actor, owner);
    expect(target).not.toBeNull();
    await expect(repository.updateTarget(target!, foreign, { name: "changed" })).rejects.toMatchObject({
      statusCode: 403,
    });
    const changed = await repository.updateTarget(target!, owner, { content: "allowed" });
    expect(changed.content).toBe("allowed");
    const current = await repository.findTarget(row.id, actor, owner);
    await repository.deleteTarget(current!, owner);
    expect(await repository.findTarget(row.id, actor, owner)).toBeNull();
    expect(await groups.resourceExistsInAccount(userScriptArn(owner, actor, row.id), owner)).toBe(false);
  });
});

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";

const version = "20261023-iam-policy-authorization";
const cli = path.resolve(".tmp/migrations", version, "runner.cjs");
function run(args: string[], overrides: Record<string, string | undefined> = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: process.env.APPSERVER_TEST_DATABASE_URL ?? process.env.DATABASE_URL,
      IAM_AUTHORIZATION_MODE: "legacy",
      ...overrides,
    },
    encoding: "utf8",
    timeout: 60000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const events = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .filter((line) => line.startsWith('{"event":'))
    .map((line) => JSON.parse(line));
  return { status: result.status, events };
}
let owner: string, policyId: string;
beforeAll(() => {
  const bundle = spawnSync(process.execPath, [path.resolve("migrations", version, "bundle.mjs")], {
    encoding: "utf8",
    timeout: 60000,
    windowsHide: true,
  });
  expect(bundle.status).toBe(0);
}, 60000);
beforeEach(async () => {
  await prisma.user.deleteMany();
  await prisma.group.deleteMany();
  owner = (
    await prisma.user.create({
      data: {
        username: "cli-owner-" + randomUUID(),
        password: "fixture-only",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
  const child = await prisma.user.create({
    data: {
      username: "cli-child-" + randomUUID(),
      password: "fixture-only",
      permissionAdds: [],
      permissionRemoves: [],
      accountOwnerId: owner,
      parentUserId: owner,
    },
  });
  const policy = await prisma.ramPolicy.create({
    data: { name: "cli-policy-" + randomUUID(), accountOwnerId: owner, permissions: [Permission.RAM_USER_READ] },
  });
  policyId = policy.id;
  await prisma.ramPolicyAttachment.create({
    data: { accountOwnerId: owner, policyId, targetType: "user", targetId: child.id },
  });
});

describe("standalone versioned IAM migration CLI", { timeout: 60000 }, () => {
  it("runs source-free preflight, apply and idempotent rerun without mutating legacy data", async () => {
    expect(run(["--all-accounts"])).toMatchObject({
      status: 0,
      events: expect.arrayContaining([
        expect.objectContaining({ event: "iam-deployment-migration-complete", mode: "dry-run", verified: false }),
      ]),
    });
    expect(await prisma.ramPolicyVersion.count()).toBe(0);
    expect(await prisma.ramAuthorization.count()).toBe(0);
    const apply = run(["--all-accounts", "--apply"]);
    expect(apply).toMatchObject({
      status: 0,
      events: expect.arrayContaining([
        expect.objectContaining({ event: "iam-deployment-migration-complete", mode: "apply", verified: true }),
      ]),
    });
    expect(await prisma.ramPolicyVersion.count()).toBe(1);
    expect(await prisma.ramAuthorization.count()).toBe(1);
    expect(run(["--account-owner-id", owner, "--apply"]).status).toBe(0);
    expect(await prisma.ramPolicyVersion.count()).toBe(1);
    expect(await prisma.ramAuthorization.count()).toBe(1);
    expect(await prisma.ramPolicyAttachment.count()).toBe(1);
    expect((await prisma.ramPolicy.findUniqueOrThrow({ where: { id: policyId } })).permissions).toEqual([
      Permission.RAM_USER_READ,
    ]);
  });
  it("exits nonzero before writes on invalid source data and on drift after a previous apply", async () => {
    await prisma.user.update({ where: { id: owner }, data: { permissionRemoves: ["unknown:permission"] } });
    expect(run(["--all-accounts", "--apply"])).toMatchObject({
      status: 1,
      events: expect.arrayContaining([
        expect.objectContaining({ event: "iam-deployment-migration-failed", code: "invalid-sources" }),
      ]),
    });
    expect(await prisma.ramPolicyVersion.count()).toBe(0);
    await prisma.user.update({ where: { id: owner }, data: { permissionRemoves: [] } });
    expect(run(["--all-accounts", "--apply"]).status).toBe(0);
    await prisma.ramPolicy.update({ where: { id: policyId }, data: { permissions: [Permission.RAM_USER_DELETE] } });
    expect(run(["--all-accounts", "--apply"]).status).toBe(1);
    expect(await prisma.ramPolicyVersion.count()).toBe(1);
    expect(await prisma.ramAuthorization.count()).toBe(1);
  });
  it("rejects scope and database configuration failures with safe nonzero command status", () => {
    expect(run([]).status).toBe(1);
    expect(run(["--all-accounts", "--account-owner-id", owner]).status).toBe(1);
    expect(run(["--all-accounts"], { DATABASE_URL: "" })).toMatchObject({
      status: 1,
      events: [{ event: "iam-deployment-migration-failed", code: "operation-failed" }],
    });
  });
});

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { BalanceTransferRepository } from "@/store/billing/balance-transfer.repository";
import { BalanceGiftCodeIamService } from "@/services/billing/balance-gift-code-iam.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { balanceGiftCodeArn } from "@/iam/resources/balance-resources";
import type { TypedRequest } from "@/types/express";

const repository = BalanceTransferRepository.getInstance();
let owner: string, actor: string, peer: string, foreign: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "gift-iam-fixture-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const createCode = (createdBy = actor, createTime = new Date()) =>
  prisma.balanceGiftCode.create({
    data: {
      createdBy,
      code: "ugc_fixture_" + randomUUID(),
      amount: 10,
      feeAmount: 0,
      feePercent: 0,
      cancelFeeRefundPercent: 0,
      totalDebit: 10,
      createTime,
    },
  });
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    params: {},
  }) as unknown as TypedRequest;

beforeEach(async () => {
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  foreign = await user();
});

describe("balance gift code IAM storage boundaries", () => {
  it("checks resource-group ownership from the creator and never accepts case or parent aliases", async () => {
    const code = await createCode();
    const groups = RamResourceGroupRepository.getInstance();
    expect(await groups.resourceExistsInAccount(balanceGiftCodeArn(owner, actor, code.id), owner)).toBe(true);
    expect(await groups.resourceExistsInAccount(balanceGiftCodeArn(owner, peer, code.id), owner)).toBe(false);
    expect(await groups.resourceExistsInAccount(balanceGiftCodeArn(foreign, actor, code.id), foreign)).toBe(false);
    expect(await groups.resourceExistsInAccount(balanceGiftCodeArn(owner, actor, code.id.toUpperCase()), owner)).toBe(
      false,
    );
    await prisma.balanceGiftCode.update({ where: { id: code.id }, data: { status: -1 } });
    expect(await groups.resourceExistsInAccount(balanceGiftCodeArn(owner, actor, code.id), owner)).toBe(false);
  });

  it("scans metadata for only the account-owned creator and never loads code strings", async () => {
    const code = await createCode();
    await createCode(peer);
    await createCode(foreign);
    const rows = await repository.scanGiftCodeTargets(actor, owner);
    expect(rows.map((row) => row.id)).toEqual([code.id]);
    expect(rows[0]).not.toHaveProperty("code");
    expect(await repository.findGiftCodeTarget(code.id, peer, owner)).toBeNull();
    expect(await repository.findGiftCodeTarget(code.id, actor, foreign)).toBeNull();
    expect(await repository.findGiftCodeTarget(code.id.toUpperCase(), actor, owner)).toMatchObject({ id: code.id });
  });

  it("uses a stable timestamp and ID cursor and refuses stale hydration", async () => {
    const older = await createCode(actor, new Date("2026-10-10T00:00:00Z"));
    const newer = await createCode(actor, new Date("2026-10-11T00:00:00Z"));
    const rows = await repository.scanGiftCodeTargets(actor, owner);
    expect(rows.map((row) => row.id)).toEqual([newer.id, older.id]);
    expect((await repository.scanGiftCodeTargets(actor, owner, rows[0])).map((row) => row.id)).toEqual([older.id]);
    expect((await repository.readGiftCodeTargets(actor, owner, rows.slice(0, 1))).map((row) => row.id)).toEqual([
      newer.id,
    ]);
    await prisma.balanceGiftCode.update({
      where: { id: newer.id },
      data: { state: "cancelled", updateTime: new Date(rows[0].updateTime.getTime() + 1000) },
    });
    expect(await repository.readGiftCodeTargets(actor, owner, rows.slice(0, 1))).toEqual([]);
    expect(await repository.readGiftCodeTargets(actor, foreign, rows.slice(1))).toEqual([]);
  });

  it("counts only allowed records and keeps denied codes out of the list", async () => {
    const allowed = await createCode(actor, new Date("2026-10-10T00:00:00Z"));
    const denied = await createCode(actor, new Date("2026-10-11T00:00:00Z"));
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:balance:ListGiftCodes",
        Resource: balanceGiftCodeArn(owner, actor, denied.id),
      },
    });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "gift-deny-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
    await RamPolicyRepository.getInstance().attachPolicy(owner, policy.id, "user", actor);
    const page = await BalanceGiftCodeIamService.getInstance().list(actor, 1, 10, request());
    expect(page.total).toBe(1);
    expect(page.records.map((row) => row.id)).toEqual([allowed.id]);
    expect(JSON.stringify(page)).not.toContain(denied.code);
  });
});

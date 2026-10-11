import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { CarpoolRepository } from "@/store/billing/carpool.repository";
import { CarpoolOrderIamService } from "@/services/billing/carpool-order-iam.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { carpoolArn } from "@/iam/resources/carpool-resources";
import type { TypedRequest } from "@/types/express";

let owner: string, actor: string, peer: string, templateId: string;
const repository = CarpoolRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "carpool-iam-fixture-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const order = (userId = actor, createTime = new Date()) =>
  prisma.carpoolOrder.create({
    data: {
      ownerUserId: userId,
      packageTemplateId: templateId,
      packageName: "fixture",
      salePrice: 10,
      upstreamCost: 5,
      maxMembers: 3,
      totalQuota: 100,
      validityDays: 30,
      createTime,
      members: { create: { userId, role: "owner" } },
    },
  });
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
  }) as unknown as TypedRequest;

beforeEach(async () => {
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  const pass = await prisma.monthlyPassTemplate.create({
    data: { name: "pass-fixture-" + randomUUID(), defaultQuota: 100 },
  });
  templateId = (
    await prisma.carpoolPackageTemplate.create({
      data: {
        name: "carpool-fixture-" + randomUUID(),
        salePrice: 10,
        upstreamCost: 5,
        maxMembers: 3,
        monthlyPassTemplateId: pass.id,
        snapshotQuota: 100,
        snapshotValidityDays: 30,
      },
    })
  ).id;
});

describe("carpool member IAM storage boundaries", () => {
  it("selects metadata only for an active account member before loading order contents", async () => {
    const own = await order();
    await order(peer);
    const rows = await repository.scanMemberOrderTargets(actor, owner);
    expect(rows.map((row) => row.id)).toEqual([own.id]);
    expect(rows[0]).not.toHaveProperty("packageName");
    expect(rows[0]).not.toHaveProperty("events");
    expect(await repository.findMemberOrderTarget(own.id, peer, owner)).toBeNull();
    expect(await repository.findMemberOrderTarget(own.id, actor, "foreign")).toBeNull();
    await prisma.carpoolMember.updateMany({ where: { orderId: own.id, userId: actor }, data: { status: 0 } });
    expect(await repository.findMemberOrderTarget(own.id, actor, owner)).toBeNull();
    expect(await repository.readMemberOrderTargets(actor, owner, rows)).toEqual([]);
  });

  it("validates final snapshots and applies keyset pagination within membership scope", async () => {
    const older = await order(actor, new Date("2026-10-10T00:00:00Z"));
    const newer = await order(actor, new Date("2026-10-11T00:00:00Z"));
    const rows = await repository.scanMemberOrderTargets(actor, owner);
    expect(rows.map((row) => row.id)).toEqual([newer.id, older.id]);
    expect(
      (await repository.scanMemberOrderTargets(actor, owner, undefined, undefined, rows[0])).map((row) => row.id),
    ).toEqual([older.id]);
    await prisma.carpoolOrder.update({
      where: { id: newer.id },
      data: { state: "cancelled", updateTime: new Date(rows[0].updateTime.getTime() + 1000) },
    });
    expect(await repository.readMemberOrderTargets(actor, owner, [rows[0]])).toEqual([]);
  });

  it("returns zero with no Allow and hydrates only specifically granted orders", async () => {
    const allowed = await order();
    await order();
    await expect(
      CarpoolOrderIamService.getInstance().list(actor, 1, 20, undefined, undefined, request()),
    ).resolves.toEqual({ total: 0, records: [] });
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: "quyan:carpool:ListMyOrders",
        Resource: carpoolArn(owner, "order", allowed.id),
      },
    });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "carpool-grant-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
    await RamPolicyRepository.getInstance().attachPolicy(owner, policy.id, "user", actor);
    const page = await CarpoolOrderIamService.getInstance().list(actor, 1, 20, undefined, undefined, request());
    expect(page.total).toBe(1);
    expect(page.records.map((row) => row.id)).toEqual([allowed.id]);
  });
});

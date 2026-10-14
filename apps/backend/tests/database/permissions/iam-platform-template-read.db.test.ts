import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { Permission, type IamPlatformTemplateKind } from "@quyan/shared";
import { PlatformTemplateReadIamService } from "@/services/billing/platform-template-read-iam.service";
import { PlatformTemplateReadRepository } from "@/store/billing/platform-template-read.repository";
import { platformTemplateArn, platformTemplateDefinition } from "@/iam/resources/platform-template-resources";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RemoteTerminalProductService } from "@/services/remote-terminal/remote-terminal-product.service";
import { CarpoolService } from "@/services/billing/carpool.service";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode;
let owner: string, actor: string, groupId: string, monthlyId: string;
let terminal: string[], carpool: string[];
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "template-iam-" + randomUUID(),
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
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "client:Fake" },
    secure: true,
    ip: "192.0.2.30",
  }) as unknown as TypedRequest;
const ids = (kind: IamPlatformTemplateKind) => (kind === "remote-terminal" ? terminal : carpool);
const read = (kind: IamPlatformTemplateKind, page = 1, pageSize = 1, filters = {}) =>
  PlatformTemplateReadIamService.getInstance(kind).list(
    request(),
    { page, pageSize },
    filters,
    (row) => ({ id: row.id, name: row.name }),
    async () => {
      throw new Error("legacy read must not run");
    },
  );
async function deny(kind: IamPlatformTemplateKind, id: string, action?: string) {
  const definition = platformTemplateDefinition(kind);
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Deny", Action: action ?? definition.action, Resource: platformTemplateArn(kind, id) },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "template-deny-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
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
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  groupId = (
    await prisma.group.create({
      data: {
        username: "template-global-" + randomUUID(),
        name: "fixture platform templates",
        level: 0,
        accountOwnerId: null,
        permissions: [Permission.REMOTE_TERMINAL_PRODUCT_READ, Permission.CARPOOL_TEMPLATE_READ],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  monthlyId = (
    await prisma.monthlyPassTemplate.create({ data: { name: "fixture-monthly-" + randomUUID(), defaultQuota: 10 } })
  ).id;
  terminal = [];
  carpool = [];
  for (let index = 0; index < 2; index++) {
    const createTime = new Date("2026-01-0" + (index + 1)),
      updateTime = new Date("2026-02-0" + (2 - index));
    terminal.push(
      (
        await prisma.remoteTerminalProductTemplate.create({
          data: {
            name: "fixture-terminal-" + randomUUID(),
            description: "PRIVATE-UNREADABLE-" + index,
            createTime,
            updateTime,
            devicePrice: index + 1,
            terminalPrice: index + 2,
          },
        })
      ).id,
    );
    carpool.push(
      (
        await prisma.carpoolPackageTemplate.create({
          data: {
            name: "fixture-carpool-" + randomUUID(),
            createTime,
            updateTime,
            salePrice: 10,
            upstreamCost: 2,
            maxMembers: 2,
            monthlyPassTemplateId: monthlyId,
            snapshotQuota: 10,
            snapshotValidityDays: 30,
            snapshotAllowedChannels: "PRIVATE-CHANNELS-" + index,
          },
        })
      ).id,
    );
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.carpoolPackageTemplate.deleteMany({ where: { id: { in: carpool } } });
  await prisma.remoteTerminalProductTemplate.deleteMany({ where: { id: { in: terminal } } });
  await prisma.monthlyPassTemplate.delete({ where: { id: monthlyId } });
  env.security.iamAuthorizationMode = mode;
});
describe("persisted platform template resource reads", () => {
  it("returns no template when there is no matching Allow even with a valid management ceiling", async () => {
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockResolvedValue([]);
    expect(await read("remote-terminal")).toMatchObject({ total: 0, records: [] });
  });
  it.each(["remote-terminal", "carpool"] as const)(
    "returns only allowed %s resources and authorized totals",
    async (kind) => {
      await deny(kind, ids(kind)[0]!);
      const repo = PlatformTemplateReadRepository.getInstance(kind),
        hydrate = vi.spyOn(repo, "hydrate");
      const result = await read(kind);
      expect(result.total).toBe(1);
      expect(result.records.map((row) => row.id)).toEqual([ids(kind)[1]]);
      expect(hydrate.mock.calls[0][1].map((row) => row.id)).toEqual([ids(kind)[1]]);
    },
  );
  it.each(["remote-terminal", "carpool"] as const)(
    "keeps denied %s content in the database during metadata scans",
    async (kind) => {
      const rows = await PlatformTemplateReadRepository.getInstance(kind).scan({});
      expect(rows).toHaveLength(2);
      expect(Object.keys(rows[0]!).sort()).toEqual([
        "createTime",
        "displayOrder",
        "id",
        "revision",
        "status",
        "updateTime",
      ]);
      expect(JSON.stringify(rows)).not.toContain("PRIVATE");
      expect(rows.every((row) => /^[a-f0-9]{64}$/.test(row.revision))).toBe(true);
    },
  );
  it("preserves terminal update-time and carpool creation-time ordering", async () => {
    expect((await read("remote-terminal")).records[0]!.id).toBe(terminal[0]);
    expect((await read("carpool")).records[0]!.id).toBe(carpool[1]);
    expect((await read("remote-terminal", 2)).records[0]!.id).toBe(terminal[1]);
    expect((await read("carpool", 3)).records).toEqual([]);
  });
  it.each(["remote-terminal", "carpool"] as const)(
    "cannot grant platform %s access through an account-owned group",
    async (kind) => {
      await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
      const repo = PlatformTemplateReadRepository.getInstance(kind),
        scan = vi.spyOn(repo, "scan");
      await expect(read(kind)).rejects.toMatchObject({ statusCode: 403 });
      expect(scan).not.toHaveBeenCalled();
    },
  );
  it.each(["remote-terminal", "carpool"] as const)("rejects %s group revocation during hydration", async (kind) => {
    const repo = PlatformTemplateReadRepository.getInstance(kind),
      hydrate = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementationOnce(async (principal, targets) => {
      const result = await hydrate(principal, targets);
      await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      return result;
    });
    await expect(read(kind)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["remote-terminal", "carpool"] as const)(
    "rejects %s content changes without updateTime changes",
    async (kind) => {
      const repo = PlatformTemplateReadRepository.getInstance(kind),
        targets = await repo.scan({});
      if (kind === "remote-terminal")
        await prisma.$executeRaw`UPDATE remote_terminal_product_templates SET description='fixture-changed' WHERE id=${ids(kind)[0]}`;
      else
        await prisma.$executeRaw`UPDATE carpool_package_templates SET snapshotAllowedChannels='fixture-changed' WHERE id=${ids(kind)[0]}`;
      const principal = {
        subjectUserId: actor,
        principalUserId: actor,
        accountOwnerId: owner,
        subjectType: "sub_user" as const,
      };
      await expect(repo.hydrate(principal, targets)).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("filters terminal status including explicitly requested archived records", async () => {
    await prisma.remoteTerminalProductTemplate.update({ where: { id: terminal[0] }, data: { status: -1 } });
    expect((await read("remote-terminal")).total).toBe(1);
    expect((await read("remote-terminal", 1, 10, { status: -1 })).records.map((row) => row.id)).toEqual([terminal[0]]);
  });
  it("retains literal keyword filtering and publication status", async () => {
    await prisma.carpoolPackageTemplate.update({
      where: { id: carpool[0] },
      data: { name: "literal%_" + randomUUID(), publishStatus: "published" },
    });
    const result = await read("carpool", 1, 10, { keyword: "literal%_", publishStatus: "published" });
    expect(result.total).toBe(1);
    expect(result.records.map((row) => row.id)).toEqual([carpool[0]]);
  });
  it("routes actual business DTO projections through the native read protocol", async () => {
    await deny("remote-terminal", terminal[0]!);
    await deny("carpool", carpool[0]!);
    const terminalResult = await RemoteTerminalProductService.getInstance().listTemplates(
      1,
      20,
      undefined,
      undefined,
      request(),
    );
    const carpoolResult = await CarpoolService.getInstance().listTemplates(1, 20, undefined, undefined, request());
    expect(terminalResult.records.map((row) => row.id)).toEqual([terminal[1]]);
    expect(carpoolResult.records.map((row) => row.id)).toEqual([carpool[1]]);
    expect(carpoolResult.records[0]?.upstreamCost).toBe(2);
  });
});

const optionRead = (page = 1, pageSize = 20, keyword?: string) =>
  RemoteTerminalProductService.getInstance().getFilterOptions(page, pageSize, keyword, request());
describe("terminal template option database boundary", () => {
  it("returns only admitted option names and totals without loading price DTOs", async () => {
    await deny("remote-terminal", terminal[0]!, "quyan:remote_terminal:ListTemplateOptions");
    const repo = PlatformTemplateReadRepository.getInstance("remote-terminal");
    const full = vi.spyOn(repo, "hydrate"),
      options = vi.spyOn(repo, "hydrateOptions");
    const result = await optionRead(1, 1);
    expect(result.templateTotal).toBe(1);
    expect(result.templates.map((row) => row.id)).toEqual([terminal[1]]);
    expect(Object.keys(result.templates[0]!).sort()).toEqual(["id", "name", "publishStatus", "status"]);
    expect(full).not.toHaveBeenCalled();
    expect(options.mock.calls[0][1].map((row) => row.id)).toEqual([terminal[1]]);
  });
  it.each([Permission.REMOTE_TERMINAL_ASSIGNMENT_READ, Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ])(
    "allows the persisted global ANY ceiling through %s without product-detail permission",
    async (permission) => {
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [permission] } });
      expect((await optionRead()).templateTotal).toBe(2);
      await expect(read("remote-terminal")).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("orders option pages by name and preserves literal keyword filtering", async () => {
    await prisma.remoteTerminalProductTemplate.update({ where: { id: terminal[0] }, data: { name: "z-template" } });
    await prisma.remoteTerminalProductTemplate.update({ where: { id: terminal[1] }, data: { name: "a-template%_" } });
    expect((await optionRead(1, 1)).templates[0]?.id).toBe(terminal[1]);
    expect((await optionRead(2, 1)).templates[0]?.id).toBe(terminal[0]);
    expect((await optionRead(1, 20, "%_")).templates.map((row) => row.id)).toEqual([terminal[1]]);
    expect((await optionRead(3, 1)).templates).toEqual([]);
  });
  it("rejects option names changed without a timestamp update", async () => {
    const repo = PlatformTemplateReadRepository.getInstance("remote-terminal"),
      targets = await repo.scan({ order: "name" });
    await prisma.$executeRaw`UPDATE remote_terminal_product_templates SET name='fixture-new-name' WHERE id=${terminal[0]}`;
    await expect(
      repo.hydrateOptions(
        { subjectUserId: actor, principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user" },
        targets,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects revoked platform eligibility after narrow hydration", async () => {
    const repo = PlatformTemplateReadRepository.getInstance("remote-terminal"),
      hydrate = repo.hydrateOptions.bind(repo);
    vi.spyOn(repo, "hydrateOptions").mockImplementationOnce(async (principal, targets) => {
      const result = await hydrate(principal, targets);
      await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      return result;
    });
    await expect(optionRead()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses an account-owned group before scanning option metadata", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    const scan = vi.spyOn(PlatformTemplateReadRepository.getInstance("remote-terminal"), "scan");
    await expect(optionRead()).rejects.toMatchObject({ statusCode: 403 });
    expect(scan).not.toHaveBeenCalled();
  });
});

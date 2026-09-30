import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { prisma } from "@/config/database";
import { createApp } from "@/app";
import { Permission } from "@/constant/permission";
import { JWTAccessIns } from "@/util/auth";
import { hashPassword } from "@/util/crypto";

describe("probe account management access", () => {
  let app: Express;
  const groups: string[] = [];
  const users: string[] = [];
  let readerToken = "";
  let managerToken = "";
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
  beforeAll(async () => {
    app = createApp();
    for (const [role, permissions] of [
      ["reader", [Permission.RELAY_CHANNEL_PROBE_READ]],
      ["manager", [Permission.RELAY_CHANNEL_PROBE_READ, Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE]],
    ] as const) {
      const group = await prisma.group.create({
        data: {
          username: `probe_${role}_${suffix}`,
          name: `Probe ${role}`,
          level: 1,
          permissions: JSON.stringify(permissions),
        },
      });
      groups.push(group.id);
      const user = await prisma.user.create({
        data: {
          username: `probe_${role}_${suffix}`,
          password: hashPassword("test-password"),
          groupId: group.id,
          permissionAdds: [],
          permissionRemoves: [],
        },
      });
      users.push(user.id);
      const token = JWTAccessIns.generateToken(
        {
          userId: user.id,
          updatedAt: user.updateTime.toISOString(),
          status: user.status,
        },
        3600,
      );
      if (role === "manager") managerToken = token;
      else readerToken = token;
    }
  });
  afterAll(async () => {
    if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
    if (groups.length) await prisma.group.deleteMany({ where: { id: { in: groups } } });
  });
  it("does not allow probe readers to list or bind shared accounts", async () => {
    const base = "/v1/relay-channel-probes/accounts";
    expect((await request(app).get(base)).status).toBe(401);
    expect((await request(app).get(base).set("Authorization", `Bearer ${readerToken}`)).status).toBe(403);

    const allowed = await request(app).get(base).set("Authorization", `Bearer ${managerToken}`);
    expect(allowed.status).toBe(200);
    expect(JSON.stringify(allowed.body)).not.toContain("encryptedCredentials");
  });
});

import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { prisma } from "@/config/database";
import { UserService } from "@/services/users/user.service";
it("returns the server-resolved account for root and RAM user DTOs without exposing credentials", async () => {
  const owner = await prisma.user.create({
    data: {
      username: "context-owner-" + randomUUID(),
      password: "fixture-only",
      permissionAdds: [],
      permissionRemoves: [],
    },
  });
  const child = await prisma.user.create({
    data: {
      username: "context-child-" + randomUUID(),
      password: "fixture-only",
      accountOwnerId: owner.id,
      parentUserId: owner.id,
      userType: "ram_user",
      permissionAdds: [],
      permissionRemoves: [],
    },
  });
  const service = new UserService();
  expect((await service.getUserById(owner.id))?.accountOwnerId).toBe(owner.id);
  const dto = await service.getUserById(child.id);
  expect(dto?.accountOwnerId).toBe(owner.id);
  expect(dto).not.toHaveProperty("password");
  expect(dto).not.toHaveProperty("permissionAdds");
  expect((await service.getAllUsers()).find((user) => user.id === owner.id)?.accountOwnerId).toBe(owner.id);
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../src/config/database";
import { UserRepository } from "../../../src/store/users/user.repository";
import { hashPassword } from "../../../src/util/crypto";
import { AccountStatus } from "../../../src/util/auth/account-status";

describe("UserRepository password reset lookup", () => {
  const repository = UserRepository.getInstance();
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const createdUserIds: string[] = [];
  let groupId = "";

  beforeAll(async () => {
    groupId = (
      await prisma.group.create({
        data: {
          username: `uprg_${suffix}`,
          name: "User Repository Test Group",
          level: 1,
          permissions: JSON.stringify([]),
        },
      })
    ).id;
  });

  afterEach(async () => {
    if (createdUserIds.length === 0) return;

    await prisma.user.deleteMany({
      where: { id: { in: createdUserIds.splice(0, createdUserIds.length) } },
    });
  });

  afterAll(async () => {
    if (groupId)
      await prisma.group.deleteMany({
        where: { id: groupId },
      });
  });

  async function createUser(status: AccountStatus, label: string) {
    const user = await prisma.user.create({
      data: {
        username: `upr_${label}_${suffix}`,
        password: hashPassword("test_password_123"),
        email: `upr_${label}_${suffix}@test.com`,
        name: `${label} user`,
        groupId,
        permissionAdds: [],
        permissionRemoves: [],
        status,
      },
    });

    createdUserIds.push(user.id);
    return user;
  }

  it("returns active users for password-reset lookup", async () => {
    const user = await createUser(AccountStatus.ACTIVE, "active");

    const result = await repository.findActiveByUsernameAndEmail(user.username, user.email!);
    const legacyResult = await repository.findByUsernameAndEmailInNonDeleted(user.username, user.email!);

    expect(result?.id).toBe(user.id);
    expect(legacyResult?.id).toBe(user.id);
  });

  it("excludes disabled users from password-reset lookup", async () => {
    const user = await createUser(AccountStatus.DISABLED, "disabled");

    await expect(repository.findActiveByUsernameAndEmail(user.username, user.email!)).resolves.toBeNull();
    await expect(repository.findByUsernameAndEmailInNonDeleted(user.username, user.email!)).resolves.toBeNull();
  });

  it("excludes deleted users from password-reset lookup", async () => {
    const user = await createUser(AccountStatus.DELETED, "deleted");

    await expect(repository.findActiveByUsernameAndEmail(user.username, user.email!)).resolves.toBeNull();
    await expect(repository.findByUsernameAndEmailInNonDeleted(user.username, user.email!)).resolves.toBeNull();
  });
});

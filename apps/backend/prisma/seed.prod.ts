import { PrismaClient } from "@prisma/client";
import md5 from "md5";
import { Permission } from "../src/constant/permission";

const prisma = new PrismaClient();

async function main() {
  console.log("开始初始化数据库...\n");

  // ==================== 创建超级管理员组 ====================
  console.log("创建超级管理员组...");

  const adminGroup = await prisma.group.upsert({
    where: { username: "admin" },
    update: { permissions: JSON.stringify(Object.values(Permission)) },
    create: {
      username: "admin",
      name: "超级管理员",
      permissions: JSON.stringify(Object.values(Permission)),
      level: 0,
      description: "拥有系统所有权限的超级管理员组",
    },
  });

  console.log("✓ 超级管理员组创建完成\n");

  // ==================== 创建超级管理员账号 ====================
  console.log("创建超级管理员账号...");

  const adminPassword = md5(md5("admin123"));
  await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      name: "超级管理员",
      password: adminPassword,
      email: "admin@example.com",
      groupId: adminGroup.id,
      permissionAdds: JSON.stringify([]),
      permissionRemoves: JSON.stringify([]),
    },
  });

  console.log("✓ 超级管理员账号创建完成\n");

  console.log("===========================================");
  console.log("数据库初始化完成！");
  console.log("===========================================");
  console.log("\n默认账号:");
  console.log("  用户名: admin");
  console.log("  密码: admin123");
  console.log("===========================================\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

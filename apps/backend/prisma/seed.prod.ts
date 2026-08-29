import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { Permission } from "../src/constant/permission";
import { hashPassword } from "../src/util/crypto";

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

  const existingAdmin = await prisma.user.findUnique({ where: { username: "admin" } });
  if (!existingAdmin) {
    const credentialPath = process.env.PROD_SEED_CREDENTIAL_FILE;
    if (!credentialPath) throw new Error("PROD_SEED_CREDENTIAL_FILE is required when creating the production admin");

    const adminPassword = randomBytes(24).toString("base64url");
    const absoluteCredentialPath = path.resolve(credentialPath);
    fs.mkdirSync(path.dirname(absoluteCredentialPath), { recursive: true });
    fs.writeFileSync(absoluteCredentialPath, `username=admin\npassword=${adminPassword}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    try {
      await prisma.user.create({
        data: {
          username: "admin",
          name: "超级管理员",
          password: hashPassword(adminPassword),
          email: "admin@example.com",
          groupId: adminGroup.id,
          permissionAdds: JSON.stringify([]),
          permissionRemoves: JSON.stringify([]),
        },
      });
    } catch (error) {
      try {
        fs.unlinkSync(absoluteCredentialPath);
      } catch {
        // Preserve the original database error; operators can remove the orphaned file manually.
      }
      throw error;
    }
    console.log(`管理员凭据已写入一次性安全文件: ${absoluteCredentialPath}`);
  }

  console.log("✓ 超级管理员账号创建完成\n");

  console.log("===========================================");
  console.log("数据库初始化完成！");
  console.log("===========================================");
  console.log("\n管理员账号已初始化；密码不会写入日志，请从安全凭据文件读取。\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

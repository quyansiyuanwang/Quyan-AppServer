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

  // ==================== 创建系统级 OAuth 客户端 ====================
  console.log("创建系统级 OAuth 客户端...");

  const adminUser = await prisma.user.findUnique({
    where: { username: "admin" },
  });

  if (!adminUser) {
    throw new Error("Admin user not found. Cannot create system OAuth clients.");
  }

  await prisma.oAuthClient.upsert({
    where: { clientId: "quyan-cli" },
    update: {
      reviewStatus: "approved",
      isSystemClient: true,
      scopes: JSON.stringify([
        "profile",
        "relay:token:read",
        "relay:token:create",
        "relay:token:update",
        "relay:token:delete",
        "relay:channel:read",
        "relay:usage:read",
        "balance:read",
      ]),
    },
    create: {
      clientId: "quyan-cli",
      name: "Quyan CLI",
      description: "Official Quyan command-line interface",
      clientType: "public",
      clientSecretHash: null,
      grantTypes: JSON.stringify(["authorization_code", "refresh_token"]),
      redirectUris: JSON.stringify(["http://127.0.0.1:40016/callback"]),
      scopes: JSON.stringify([
        "profile",
        "relay:token:read",
        "relay:token:create",
        "relay:token:update",
        "relay:token:delete",
        "relay:channel:read",
        "relay:usage:read",
        "balance:read",
      ]),
      isPkceRequired: true,
      accessTokenLifetime: 3600,
      refreshTokenLifetime: 604800,
      reviewStatus: "approved",
      isSystemClient: true,
      userId: adminUser.id,
      homepageUrl: "https://github.com/your-org/quyan-cli",
      logoUrl: null,
      policyUrl: null,
      tosUrl: null,
    },
  });

  console.log("  ✓ quyan-cli (Official CLI)");
  console.log("✓ 系统级 OAuth 客户端创建完成\n");

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

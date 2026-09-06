import { PrismaClient } from "@prisma/client";
import { SYSTEM_OAUTH_CLIENTS } from "../src/constant/system-oauth-clients";

const prisma = new PrismaClient();

/**
 * 系统级 OAuth 客户端初始化脚本
 *
 * 用途：
 * - 首次部署时创建系统级 OAuth 客户端
 * - 升级时更新系统客户端配置
 * - 可独立运行，不影响其他数据
 *
 * 运行方式：
 *   开发环境: pnpm run db:seed:system-clients
 *   生产环境: pnpm run db:seed:system-clients:prod
 */
async function main() {
  console.log("开始初始化系统级 OAuth 客户端...\n");

  const adminUser = await prisma.user.findUnique({
    where: { username: "admin" },
  });

  if (!adminUser) {
    throw new Error("Admin user not found. Please run main seed script first.");
  }

  // CLI 客户端
  const cliClient = await prisma.oAuthClient.upsert({
    where: { clientId: SYSTEM_OAUTH_CLIENTS.CLI.clientId },
    update: {
      reviewStatus: "approved",
      isSystemClient: true,
      // 仅更新可能变化的配置
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
      clientId: SYSTEM_OAUTH_CLIENTS.CLI.clientId,
      name: SYSTEM_OAUTH_CLIENTS.CLI.name,
      description: SYSTEM_OAUTH_CLIENTS.CLI.description,
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

  console.log(`✓ ${cliClient.name} (${cliClient.clientId})`);
  console.log(`  - 类型: ${cliClient.clientType}`);
  console.log(`  - 状态: ${cliClient.reviewStatus}`);
  console.log(`  - 系统客户端: ${cliClient.isSystemClient}`);

  // 未来可添加其他系统客户端
  // Desktop, Mobile 等

  console.log("\n===========================================");
  console.log("系统级 OAuth 客户端初始化完成！");
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

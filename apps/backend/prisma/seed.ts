import { PrismaClient } from "@prisma/client";
import md5 from "md5";
import { Permission } from "../src/constant/permission";

const prisma = new PrismaClient();

async function main() {
  console.log("开始初始化数据库...\n");

  // ==================== 创建用户组 ====================
  console.log("创建用户组...");

  // 1. 超级管理员组 - 拥有所有权限
  const adminGroup = await prisma.group.upsert({
    where: { username: "admin" },
    update: {
      permissions: JSON.stringify(Object.values(Permission)),
      description: "拥有系统所有权限的超级管理员组",
    },
    create: {
      username: "admin",
      name: "超级管理员",
      permissions: JSON.stringify(Object.values(Permission)),
      level: 0,
      description: "拥有系统所有权限的超级管理员组",
    },
  });

  // 2. 系统管理员组 - 拥有系统配置和日志权限
  const sysAdminGroup = await prisma.group.upsert({
    where: { username: "sysadmin" },
    update: {},
    create: {
      username: "sysadmin",
      name: "系统管理员",
      permissions: JSON.stringify([
        Permission.SYSTEM_CONFIG,
        Permission.SYSTEM_STATS_READ,
        Permission.SYSTEM_LOG_READ,
        Permission.SYSTEM_ERROR_REPORT_READ,
        Permission.SYSTEM_ERROR_REPORT_UPDATE,
        Permission.SYSTEM_DATA_LIFECYCLE_MANAGE,
        Permission.SYSTEM_DATA_MAINTENANCE_MANAGE,
        Permission.API_LOG_READ,
        Permission.IP_BLACKLIST_CREATE,
        Permission.IP_BLACKLIST_READ,
        Permission.IP_BLACKLIST_UPDATE,
        Permission.IP_BLACKLIST_DELETE,
        Permission.RELAY_TOKEN_CREATE,
        Permission.RELAY_TOKEN_READ,
        Permission.RELAY_TOKEN_DELETE,
        Permission.RELAY_CHANNEL_CREATE,
        Permission.RELAY_CHANNEL_READ,
        Permission.RELAY_CHANNEL_HEALTH_READ,
        Permission.RELAY_CHANNEL_POOL_METADATA_READ,
        Permission.RELAY_CHANNEL_UPDATE,
        Permission.RELAY_CHANNEL_DELETE,
        Permission.RELAY_CHANNEL_REVIEW,
        Permission.RELAY_REQUEST_DIAGNOSTICS_READ,
        Permission.RELAY_REQUEST_ROUTE_TRACE_READ,
        Permission.REDEMPTION_CODE_CREATE,
        Permission.REDEMPTION_CODE_READ,
        Permission.MONTHLY_PASS_TEMPLATE_READ,
        Permission.MONTHLY_PASS_TEMPLATE_WRITE,
        Permission.MONTHLY_PASS_ASSIGNMENT_READ,
        Permission.MONTHLY_PASS_ASSIGNMENT_WRITE,
        Permission.MONTHLY_PASS_USAGE_READ,
      ]),
      level: 3,
      description: "负责系统配置、日志和安全管理",
    },
  });

  // 3. 用户管理员组 - 管理用户和用户组
  const userAdminGroup = await prisma.group.upsert({
    where: { username: "useradmin" },
    update: {
      permissions: JSON.stringify([
        Permission.USER_CREATE,
        Permission.USER_READ,
        Permission.USER_UPDATE,
        Permission.USER_DELETE,
        Permission.GROUP_CREATE,
        Permission.GROUP_READ,
        Permission.GROUP_UPDATE,
        Permission.GROUP_DELETE,
        Permission.PERMISSION_VIEW,
        Permission.RAM_USER_CREATE,
        Permission.RAM_USER_READ,
        Permission.RAM_USER_UPDATE,
        Permission.RAM_USER_DELETE,
        Permission.RAM_ROLE_CREATE,
        Permission.RAM_ROLE_READ,
        Permission.RAM_ROLE_UPDATE,
        Permission.RAM_ROLE_DELETE,
        Permission.RAM_BINDING_CREATE,
        Permission.RAM_BINDING_READ,
        Permission.RAM_BINDING_DELETE,
        Permission.RAM_ASSUME_ROLE,
        Permission.RAM_SESSION_READ,
        Permission.RAM_SESSION_REVOKE,
      ]),
      description: "负责用户、用户组与 RAM 访问控制管理",
    },
    create: {
      username: "useradmin",
      name: "用户管理员",
      permissions: JSON.stringify([
        Permission.USER_CREATE,
        Permission.USER_READ,
        Permission.USER_UPDATE,
        Permission.USER_DELETE,
        Permission.GROUP_CREATE,
        Permission.GROUP_READ,
        Permission.GROUP_UPDATE,
        Permission.GROUP_DELETE,
        Permission.PERMISSION_VIEW,
        Permission.RAM_USER_CREATE,
        Permission.RAM_USER_READ,
        Permission.RAM_USER_UPDATE,
        Permission.RAM_USER_DELETE,
        Permission.RAM_ROLE_CREATE,
        Permission.RAM_ROLE_READ,
        Permission.RAM_ROLE_UPDATE,
        Permission.RAM_ROLE_DELETE,
        Permission.RAM_BINDING_CREATE,
        Permission.RAM_BINDING_READ,
        Permission.RAM_BINDING_DELETE,
        Permission.RAM_ASSUME_ROLE,
        Permission.RAM_SESSION_READ,
        Permission.RAM_SESSION_REVOKE,
      ]),
      level: 5,
      description: "负责用户、用户组与 RAM 访问控制管理",
    },
  });

  // 4. 编辑组 - 有部分编辑权限
  const editorGroup = await prisma.group.upsert({
    where: { username: "editor" },
    update: {},
    create: {
      username: "editor",
      name: "编辑",
      permissions: JSON.stringify([
        Permission.USER_READ,
        Permission.USER_UPDATE,
        Permission.GROUP_READ,
        Permission.API_LOG_READ,
      ]),
      level: 7,
      description: "可以查看和编辑用户信息",
    },
  });

  // 5. 查看者组 - 只有查看权限
  const viewerGroup = await prisma.group.upsert({
    where: { username: "viewer" },
    update: {},
    create: {
      username: "viewer",
      name: "查看者",
      permissions: JSON.stringify([Permission.USER_READ, Permission.GROUP_READ, Permission.API_LOG_READ]),
      level: 8,
      description: "只能查看用户和日志信息",
    },
  });

  // 6. 普通用户组 - 无特殊权限
  const userGroup = await prisma.group.upsert({
    where: { username: "user" },
    update: {},
    create: {
      username: "user",
      name: "普通用户",
      permissions: JSON.stringify([
        Permission.RELAY_CHANNEL_SUBMIT,
        Permission.RELAY_CHANNEL_PROVIDER_READ,
        Permission.RELAY_CHANNEL_PROVIDER_SETTLE,
      ]),
      level: 10,
      description: "普通用户组，无特殊权限",
    },
  });

  // 7. RAM 默认用户组 - 无特殊权限
  const _ramDefaultGroup = await prisma.group.upsert({
    where: { username: "ram-default" },
    update: {},
    create: {
      username: "ram-default",
      name: "RAM 默认用户组",
      permissions: JSON.stringify([]),
      level: 10,
      description: "RAM 子账户默认用户组，无特殊权限",
    },
  });

  console.log("✓ 用户组创建完成\n");

  // ==================== 创建用户账号 ====================
  console.log("创建用户账号...");

  // 1. 超级管理员
  const adminPassword = md5(md5("admin123"));
  await prisma.user.upsert({
    where: { username: "admin" },
    update: {
      groupId: adminGroup.id,
      permissionAdds: JSON.stringify([]),
      permissionRemoves: JSON.stringify([]),
    },
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
  console.log("  - admin (超级管理员) - 密码: admin123");

  // 2. 系统管理员
  const sysAdminPassword = md5(md5("sysadmin123"));
  await prisma.user.upsert({
    where: { username: "sysadmin" },
    update: {},
    create: {
      username: "sysadmin",
      name: "张三",
      password: sysAdminPassword,
      email: "zhangsan@example.com",
      groupId: sysAdminGroup.id,
      permissionAdds: JSON.stringify([]),
      permissionRemoves: JSON.stringify([]),
    },
  });
  console.log("  - sysadmin (系统管理员) - 密码: sysadmin123");

  // 3. 用户管理员 - 额外添加了权限管理权限
  const userAdminPassword = md5(md5("useradmin123"));
  await prisma.user.upsert({
    where: { username: "useradmin" },
    update: {
      groupId: userAdminGroup.id,
      permissionAdds: JSON.stringify([Permission.PERMISSION_ADD, Permission.PERMISSION_REMOVE]),
      permissionRemoves: JSON.stringify([]),
    },
    create: {
      username: "useradmin",
      name: "李四",
      password: userAdminPassword,
      email: "lisi@example.com",
      groupId: userAdminGroup.id,
      permissionAdds: JSON.stringify([Permission.PERMISSION_ADD, Permission.PERMISSION_REMOVE]),
      permissionRemoves: JSON.stringify([]),
    },
  });
  console.log("  - useradmin (用户管理员) - 密码: useradmin123");

  // 4. 编辑1 - 基础编辑权限
  const editor1Password = md5(md5("editor123"));
  await prisma.user.upsert({
    where: { username: "editor1" },
    update: {},
    create: {
      username: "editor1",
      name: "王五",
      password: editor1Password,
      email: "wangwu@example.com",
      groupId: editorGroup.id,
      permissionAdds: JSON.stringify([]),
      permissionRemoves: JSON.stringify([]),
    },
  });
  console.log("  - editor1 (编辑) - 密码: editor123");

  // 5. 编辑2 - 移除了部分权限
  const editor2Password = md5(md5("editor223"));
  await prisma.user.upsert({
    where: { username: "editor2" },
    update: {},
    create: {
      username: "editor2",
      name: "赵六",
      password: editor2Password,
      email: "zhaoliu@example.com",
      groupId: editorGroup.id,
      permissionAdds: JSON.stringify([]),
      permissionRemoves: JSON.stringify([Permission.USER_UPDATE]), // 移除了更新权限
    },
  });
  console.log("  - editor2 (编辑-受限) - 密码: editor223");

  // 6. 查看者1
  const viewer1Password = md5(md5("viewer123"));
  await prisma.user.upsert({
    where: { username: "viewer1" },
    update: {},
    create: {
      username: "viewer1",
      name: "孙七",
      password: viewer1Password,
      email: "sunqi@example.com",
      groupId: viewerGroup.id,
      permissionAdds: JSON.stringify([]),
      permissionRemoves: JSON.stringify([]),
    },
  });
  console.log("  - viewer1 (查看者) - 密码: viewer123");

  // 7. 查看者2 - 额外添加了IP黑名单查看权限
  const viewer2Password = md5(md5("viewer223"));
  await prisma.user.upsert({
    where: { username: "viewer2" },
    update: {},
    create: {
      username: "viewer2",
      name: "周八",
      password: viewer2Password,
      email: "zhouba@example.com",
      groupId: viewerGroup.id,
      permissionAdds: JSON.stringify([Permission.IP_BLACKLIST_READ]),
      permissionRemoves: JSON.stringify([]),
    },
  });
  console.log("  - viewer2 (查看者+) - 密码: viewer223");

  // 8-10. 普通用户
  const user1Password = md5(md5("user123"));
  await prisma.user.upsert({
    where: { username: "user1" },
    update: {},
    create: {
      username: "user1",
      name: "吴九",
      password: user1Password,
      email: "wujiu@example.com",
      groupId: userGroup.id,
      permissionAdds: JSON.stringify([]),
      permissionRemoves: JSON.stringify([]),
    },
  });
  console.log("  - user1 (普通用户) - 密码: user123");

  const user2Password = md5(md5("user223"));
  await prisma.user.upsert({
    where: { username: "user2" },
    update: {},
    create: {
      username: "user2",
      name: "郑十",
      password: user2Password,
      email: "zhengshi@example.com",
      groupId: userGroup.id,
      permissionAdds: JSON.stringify([Permission.USER_READ]), // 额外添加了用户查看权限
      permissionRemoves: JSON.stringify([]),
    },
  });
  console.log("  - user2 (普通用户+) - 密码: user223");

  const user3Password = md5(md5("user323"));
  await prisma.user.upsert({
    where: { username: "user3" },
    update: {},
    create: {
      username: "user3",
      name: "陈十一",
      password: user3Password,
      email: "chenshiyi@example.com",
      groupId: userGroup.id,
      permissionAdds: JSON.stringify([]),
      permissionRemoves: JSON.stringify([]),
    },
  });
  console.log("  - user3 (普通用户) - 密码: user323");

  console.log("✓ 用户账号创建完成\n");

  // ==================== 创建IP黑名单样例数据 ====================
  console.log("创建IP黑名单样例数据...");

  const futureDate1 = new Date();
  futureDate1.setHours(futureDate1.getHours() + 2);

  await prisma.iPBlackList.upsert({
    where: { ipAddress: "192.168.1.100" },
    update: {},
    create: {
      ipAddress: "192.168.1.100",
      triedAccounts: 3,
      ExpireTime: futureDate1,
      banLevel: 3,
    },
  });

  const futureDate2 = new Date();
  futureDate2.setDate(futureDate2.getDate() + 1);

  await prisma.iPBlackList.upsert({
    where: { ipAddress: "10.0.0.50" },
    update: {},
    create: {
      ipAddress: "10.0.0.50",
      triedAccounts: 2,
      ExpireTime: futureDate2,
      banLevel: 2,
    },
  });

  console.log("  - 192.168.1.100 (尝试账号: admin, root, test)");
  console.log("  - 10.0.0.50 (尝试账号: admin, user1)");
  console.log("✓ IP黑名单数据创建完成\n");

  // ==================== 创建API日志样例数据 ====================
  console.log("创建API日志样例数据...");

  await prisma.aPILog.upsert({
    where: { requestID: "req-001" },
    update: {},
    create: {
      requestID: "req-001",
      userID: "admin",
      path: "/auth/login",
      method: "POST",
      queryParams: JSON.stringify({}),
      bodyParams: JSON.stringify({ username: "admin" }),
      ipAddress: "127.0.0.1",
      response: JSON.stringify({ code: 0, message: "登录成功" }),
      statusCode: 200,
    },
  });

  await prisma.aPILog.upsert({
    where: { requestID: "req-002" },
    update: {},
    create: {
      requestID: "req-002",
      userID: "viewer1",
      path: "/users",
      method: "GET",
      queryParams: JSON.stringify({ page: 1, limit: 10 }),
      bodyParams: JSON.stringify({}),
      ipAddress: "192.168.1.50",
      response: JSON.stringify({ code: 0, message: "success", data: [] }),
      statusCode: 200,
    },
  });

  await prisma.aPILog.upsert({
    where: { requestID: "req-003" },
    update: {},
    create: {
      requestID: "req-003",
      userID: "user1",
      path: "/permissions/user/123",
      method: "GET",
      queryParams: JSON.stringify({}),
      bodyParams: JSON.stringify({}),
      ipAddress: "192.168.1.60",
      response: JSON.stringify({ code: 1003, message: "权限不足" }),
      statusCode: 403,
    },
  });

  console.log("  - req-001 (登录请求 - admin)");
  console.log("  - req-002 (查询用户 - viewer1)");
  console.log("  - req-003 (权限不足 - user1)");
  console.log("✓ API日志数据创建完成\n");

  // ==================== 创建默认服务器配置 ====================
  console.log("创建默认服务器配置...");

  const defaultConfigs = [
    { key: "registration.enabled", value: "false" },
    { key: "registration.maxAccountsPerEmail", value: "3" },
    { key: "registration.defaultGroupUsername", value: "user" },
    { key: "registration.verificationCodeExpiry", value: "300" },
    { key: "smtp.host", value: "" },
    { key: "smtp.port", value: "465" },
    { key: "smtp.secure", value: "true" },
    { key: "smtp.user", value: "" },
    { key: "smtp.password", value: "" },
    { key: "smtp.senderName", value: "AppSystem" },
    { key: "smtp.senderEmail", value: "" },
  ];

  for (const config of defaultConfigs)
    await prisma.serverConfig.upsert({
      where: { key: config.key },
      update: {},
      create: config,
    });

  console.log("✓ 默认服务器配置创建完成\n");

  console.log("===========================================");
  console.log("数据库初始化完成！");
  console.log("===========================================");
  console.log("\n用户账号列表:");
  console.log("  超级管理员: admin / admin123");
  console.log("  系统管理员: sysadmin / sysadmin123");
  console.log("  用户管理员: useradmin / useradmin123");
  console.log("  编辑1: editor1 / editor123");
  console.log("  编辑2: editor2 / editor223");
  console.log("  查看者1: viewer1 / viewer123");
  console.log("  查看者2: viewer2 / viewer223");
  console.log("  普通用户1: user1 / user123");
  console.log("  普通用户2: user2 / user223");
  console.log("  普通用户3: user3 / user323");
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

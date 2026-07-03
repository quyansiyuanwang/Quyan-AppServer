import { prisma } from "../src/config/database.ts";
import md5 from "md5";

/**
 * 脚本：批量加密所有用户明文密码
 * 用法：node scripts/hashAllUserPasswords.js
 */
(async () => {
  const users = await prisma.user.findMany();
  let updated = 0;
  for (const user of users)
    // 检查是否为明文（简单判断：长度小于32或不以$2开头）
    if (user.password && (!user.password.startsWith("$2") || user.password.length < 32)) {
      const hash = md5(md5(user.password));
      await prisma.user.update({
        where: { id: user.id },
        data: { password: hash },
      });
      updated++;
    }

  if (updated > 0) console.log(`已加密并保存 ${updated} 个用户密码。`);
  else console.log("所有用户密码均已加密，无需处理。");
})();

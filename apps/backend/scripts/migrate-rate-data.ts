import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function migrateRateData() {
  console.log("开始迁移费率数据...");

  try {
    // 查找所有有费率数据的交易记录
    const transactions = await prisma.balanceTransaction.findMany({
      where: {
        OR: [{ ratePerMillion: { not: null } }, { inputRate: { not: null } }, { outputRate: { not: null } }],
      },
    });

    console.log(`找到 ${transactions.length} 条需要迁移的记录`);

    let migratedCount = 0;

    for (const transaction of transactions) {
      const updates: any = {};

      // 直接将所有费率数据除以 1,000,000
      if (transaction.ratePerMillion) updates.ratePerMillion = Number(transaction.ratePerMillion) / 1000000;

      if (transaction.inputRate) updates.inputRate = Number(transaction.inputRate) / 1000000;

      if (transaction.outputRate) updates.outputRate = Number(transaction.outputRate) / 1000000;

      // 执行更新
      if (Object.keys(updates).length > 0) {
        await prisma.balanceTransaction.update({
          where: { id: transaction.id },
          data: updates,
        });
        migratedCount++;
      }
    }

    console.log(`成功迁移 ${migratedCount} 条记录`);
  } catch (error) {
    console.error("迁移失败:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

migrateRateData();

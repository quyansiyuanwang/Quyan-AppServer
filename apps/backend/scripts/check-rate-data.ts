import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkRateData() {
  const transactions = await prisma.balanceTransaction.findMany({
    where: {
      OR: [{ ratePerMillion: { not: null } }, { inputRate: { not: null } }, { outputRate: { not: null } }],
    },
    take: 10,
    orderBy: { createTime: "desc" },
  });

  console.log("最近10条费率数据：\n");
  transactions.forEach((t) => {
    console.log(`ID: ${t.id}`);
    console.log(`  创建时间: ${t.createTime}`);
    console.log(`  模型: ${t.model}`);
    console.log(`  ratePerMillion: ${t.ratePerMillion}`);
    console.log(`  inputRate: ${t.inputRate}`);
    console.log(`  outputRate: ${t.outputRate}`);
    console.log(`  tokens: ${t.tokens}`);
    console.log("---");
  });

  await prisma.$disconnect();
}

checkRateData();

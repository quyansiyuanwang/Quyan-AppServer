import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: ".env" });

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply") && !process.argv.includes("--dry-run");

const run = async (): Promise<void> => {
  const endpoints = await prisma.jsonEndpoint.findMany({
    where: { isRootSlug: false, rootSlug: null, status: { in: [0, 1] } },
    select: { id: true, slug: true },
    orderBy: { createTime: "asc" },
  });

  console.log(`[json-endpoint-root-slugs] mode=${apply ? "apply" : "dry-run"}`);
  console.log(`[json-endpoint-root-slugs] endpoints=${endpoints.length}`);

  if (!apply) {
    console.log("[json-endpoint-root-slugs] re-run with --apply before starting the application");
    return;
  }

  for (const endpoint of endpoints) {
    await prisma.jsonEndpoint.update({
      where: { id: endpoint.id },
      data: { isRootSlug: true, rootSlug: endpoint.slug },
    });
  }

  console.log(`[json-endpoint-root-slugs] migrated=${endpoints.length}`);
};

run()
  .catch((error) => {
    console.error("[json-endpoint-root-slugs] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

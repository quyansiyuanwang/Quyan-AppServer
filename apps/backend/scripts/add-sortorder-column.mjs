import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  try {
    await prisma.$executeRawUnsafe("ALTER TABLE articles ADD COLUMN sortOrder INT NOT NULL DEFAULT 0");
    console.log("sortOrder column added successfully");
  } catch (e) {
    if (e.message && e.message.includes("Duplicate column")) {
      console.log("Column already exists, skipping");
    } else {
      throw e;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);

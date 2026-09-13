/*
  Warnings:

  - You are about to alter the column `paymentRatio` on the `carpool_members` table. The data in that column could be lost. The data in that column will be cast from `Decimal(8,6)` to `Decimal(9,6)`.
  - You are about to alter the column `quotaRatio` on the `carpool_members` table. The data in that column could be lost. The data in that column will be cast from `Decimal(8,6)` to `Decimal(9,6)`.

*/
-- AlterTable
ALTER TABLE `carpool_members` MODIFY `paymentRatio` DECIMAL(9, 6) NOT NULL DEFAULT 0,
    MODIFY `quotaRatio` DECIMAL(9, 6) NOT NULL DEFAULT 0;

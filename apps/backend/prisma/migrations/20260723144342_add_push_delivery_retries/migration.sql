/*
  Warnings:

  - Added the required column `content` to the `developer_push_deliveries` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `developer_push_deliveries` ADD COLUMN `attemptCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `content` TEXT NOT NULL,
    ADD COLUMN `idempotencyKey` VARCHAR(100) NULL,
    ADD COLUMN `nextRetryAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `developer_push_deliveries_projectId_idempotencyKey_idx` ON `developer_push_deliveries`(`projectId`, `idempotencyKey`);

-- CreateIndex
CREATE INDEX `developer_push_deliveries_deliveryStatus_nextRetryAt_idx` ON `developer_push_deliveries`(`deliveryStatus`, `nextRetryAt`);

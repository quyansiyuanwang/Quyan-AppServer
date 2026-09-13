-- AlterTable
ALTER TABLE `carpool_members` ADD COLUMN `leftAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `carpool_orders` ADD COLUMN `allocationMode` VARCHAR(20) NOT NULL DEFAULT 'equal',
    ADD COLUMN `cancelledAt` DATETIME(3) NULL,
    ADD COLUMN `expiredAt` DATETIME(3) NULL,
    ADD COLUMN `formationDeadlineAt` DATETIME(3) NULL,
    ADD COLUMN `monthlyPassTemplateId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `carpool_package_templates` ADD COLUMN `formationDeadlineHours` INTEGER NOT NULL DEFAULT 72;

-- CreateTable
CREATE TABLE `carpool_order_events` (
    `id` VARCHAR(191) NOT NULL,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `orderId` VARCHAR(191) NOT NULL,
    `actorUserId` VARCHAR(191) NULL,
    `type` VARCHAR(40) NOT NULL,
    `metadata` JSON NULL,

    INDEX `carpool_order_events_orderId_createTime_idx`(`orderId`, `createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `carpool_orders_state_formationDeadlineAt_idx` ON `carpool_orders`(`state`, `formationDeadlineAt`);

-- AddForeignKey
ALTER TABLE `carpool_order_events` ADD CONSTRAINT `carpool_order_events_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `carpool_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

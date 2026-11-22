-- AlterTable
ALTER TABLE `balance_accounts` ADD COLUMN `overdraftCategories` JSON NULL,
    ADD COLUMN `overdraftRule` JSON NULL,
    ADD COLUMN `overdraftVersion` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `balance_overdraft_defaults` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `rule` JSON NOT NULL,
    `categories` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `balance_account_adjustments` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `operationId` VARCHAR(128) NOT NULL,
    `actorUserId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `requestHash` VARCHAR(64) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `before` JSON NOT NULL,
    `after` JSON NOT NULL,

    UNIQUE INDEX `balance_account_adjustments_operationId_key`(`operationId`),
    INDEX `balance_account_adjustments_userId_createTime_idx`(`userId`, `createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

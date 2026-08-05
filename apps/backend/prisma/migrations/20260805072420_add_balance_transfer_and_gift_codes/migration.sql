-- CreateTable
CREATE TABLE `balance_gift_codes` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `state` VARCHAR(20) NOT NULL DEFAULT 'active',
    `code` VARCHAR(80) NOT NULL,
    `amount` DECIMAL(15, 4) NOT NULL,
    `feeAmount` DECIMAL(15, 4) NOT NULL,
    `feePercent` DECIMAL(10, 4) NOT NULL,
    `cancelFeeRefundPercent` DECIMAL(10, 4) NOT NULL,
    `totalDebit` DECIMAL(15, 4) NOT NULL,
    `refundedAmount` DECIMAL(15, 4) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `redeemedBy` VARCHAR(191) NULL,
    `redeemedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,

    UNIQUE INDEX `balance_gift_codes_code_key`(`code`),
    INDEX `balance_gift_codes_createdBy_createTime_idx`(`createdBy`, `createTime`),
    INDEX `balance_gift_codes_redeemedBy_idx`(`redeemedBy`),
    INDEX `balance_gift_codes_state_expiresAt_idx`(`state`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `balance_transfers` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `recipientId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(15, 4) NOT NULL,
    `feeAmount` DECIMAL(15, 4) NOT NULL,
    `feePercent` DECIMAL(10, 4) NOT NULL,
    `totalDebit` DECIMAL(15, 4) NOT NULL,
    `description` VARCHAR(500) NULL,

    INDEX `balance_transfers_senderId_createTime_idx`(`senderId`, `createTime`),
    INDEX `balance_transfers_recipientId_createTime_idx`(`recipientId`, `createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `balance_gift_codes` ADD CONSTRAINT `balance_gift_codes_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `balance_gift_codes` ADD CONSTRAINT `balance_gift_codes_redeemedBy_fkey` FOREIGN KEY (`redeemedBy`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `balance_transfers` ADD CONSTRAINT `balance_transfers_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `balance_transfers` ADD CONSTRAINT `balance_transfers_recipientId_fkey` FOREIGN KEY (`recipientId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE `balance_accounts` ADD COLUMN `totalCommissionEarned` DECIMAL(10, 4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `relay_channels` ADD COLUMN `reviewReason` TEXT NULL,
    ADD COLUMN `reviewedAt` DATETIME(3) NULL,
    ADD COLUMN `reviewedByUserId` VARCHAR(191) NULL,
    ADD COLUMN `submissionStatus` VARCHAR(20) NOT NULL DEFAULT 'approved',
    ADD COLUMN `submittedByUserId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `relay_channel_providers` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `relayChannelId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `commissionPercent` DECIMAL(10, 6) NOT NULL,
    `settlementMode` VARCHAR(20) NOT NULL DEFAULT 'realtime',
    `settlementIntervalDays` INTEGER NULL,
    `settlementTime` VARCHAR(5) NULL,
    `nextSettlementAt` DATETIME(3) NULL,
    `lastSettledAt` DATETIME(3) NULL,

    INDEX `relay_channel_providers_userId_status_idx`(`userId`, `status`),
    INDEX `relay_channel_providers_settlementMode_nextSettlementAt_idx`(`settlementMode`, `nextSettlementAt`),
    UNIQUE INDEX `relay_channel_providers_relayChannelId_userId_key`(`relayChannelId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relay_channel_provider_settlements` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `providerId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 4) NOT NULL,
    `settlementMode` VARCHAR(20) NOT NULL,
    `balanceTransactionId` VARCHAR(191) NULL,
    `settledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `relay_channel_provider_settlements_balanceTransactionId_key`(`balanceTransactionId`),
    INDEX `relay_channel_provider_settlements_providerId_createTime_idx`(`providerId`, `createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relay_channel_provider_earnings` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `providerId` VARCHAR(191) NOT NULL,
    `relayUsageId` VARCHAR(191) NOT NULL,
    `grossAmount` DECIMAL(10, 4) NOT NULL,
    `commissionPercent` DECIMAL(10, 6) NOT NULL,
    `commissionAmount` DECIMAL(10, 4) NOT NULL,
    `settlementId` VARCHAR(191) NULL,
    `settledAt` DATETIME(3) NULL,

    INDEX `relay_channel_provider_earnings_providerId_settlementId_crea_idx`(`providerId`, `settlementId`, `createTime`),
    INDEX `relay_channel_provider_earnings_settlementId_idx`(`settlementId`),
    UNIQUE INDEX `relay_channel_provider_earnings_providerId_relayUsageId_key`(`providerId`, `relayUsageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `relay_channels_submissionStatus_idx` ON `relay_channels`(`submissionStatus`);

-- CreateIndex
CREATE INDEX `relay_channels_submittedByUserId_idx` ON `relay_channels`(`submittedByUserId`);

-- AddForeignKey
ALTER TABLE `relay_channels` ADD CONSTRAINT `relay_channels_submittedByUserId_fkey` FOREIGN KEY (`submittedByUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_channels` ADD CONSTRAINT `relay_channels_reviewedByUserId_fkey` FOREIGN KEY (`reviewedByUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_channel_providers` ADD CONSTRAINT `relay_channel_providers_relayChannelId_fkey` FOREIGN KEY (`relayChannelId`) REFERENCES `relay_channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_channel_providers` ADD CONSTRAINT `relay_channel_providers_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_channel_provider_settlements` ADD CONSTRAINT `relay_channel_provider_settlements_providerId_fkey` FOREIGN KEY (`providerId`) REFERENCES `relay_channel_providers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_channel_provider_earnings` ADD CONSTRAINT `relay_channel_provider_earnings_providerId_fkey` FOREIGN KEY (`providerId`) REFERENCES `relay_channel_providers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_channel_provider_earnings` ADD CONSTRAINT `relay_channel_provider_earnings_settlementId_fkey` FOREIGN KEY (`settlementId`) REFERENCES `relay_channel_provider_settlements`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

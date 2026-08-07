-- CreateTable
CREATE TABLE `relay_channel_change_requests` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `relayChannelId` VARCHAR(191) NOT NULL,
    `submittedByUserId` VARCHAR(191) NOT NULL,
    `reviewedByUserId` VARCHAR(191) NULL,
    `reviewStatus` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `reviewedAt` DATETIME(3) NULL,
    `reviewReason` TEXT NULL,
    `configSnapshot` JSON NOT NULL,
    `encryptedCredentials` LONGTEXT NULL,
    `credentialIv` VARCHAR(64) NULL,
    `credentialAuthTag` VARCHAR(64) NULL,

    INDEX `relay_channel_change_requests_relayChannelId_reviewStatus_idx`(`relayChannelId`, `reviewStatus`),
    INDEX `relay_channel_change_requests_submittedByUserId_createTime_idx`(`submittedByUserId`, `createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `relay_channel_change_requests` ADD CONSTRAINT `relay_channel_change_requests_relayChannelId_fkey` FOREIGN KEY (`relayChannelId`) REFERENCES `relay_channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_channel_change_requests` ADD CONSTRAINT `relay_channel_change_requests_submittedByUserId_fkey` FOREIGN KEY (`submittedByUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_channel_change_requests` ADD CONSTRAINT `relay_channel_change_requests_reviewedByUserId_fkey` FOREIGN KEY (`reviewedByUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

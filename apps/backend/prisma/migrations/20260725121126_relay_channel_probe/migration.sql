-- CreateTable
CREATE TABLE `relay_channel_probe_profiles` (
    `id` VARCHAR(191) NOT NULL,
    `relayChannelId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `probeFormat` VARCHAR(20) NOT NULL DEFAULT 'openai',
    `probeModel` VARCHAR(200) NOT NULL,
    `probePayload` JSON NOT NULL,
    `upstreamCurrency` VARCHAR(12) NOT NULL DEFAULT 'CNY',
    `localCurrency` VARCHAR(12) NOT NULL DEFAULT 'CNY',
    `distributionMultiplier` DECIMAL(10, 6) NOT NULL DEFAULT 1.0,
    `workflow` JSON NOT NULL,
    `encryptedCredentials` LONGTEXT NULL,
    `credentialIv` VARCHAR(128) NULL,
    `credentialAuthTag` VARCHAR(128) NULL,
    `credentialKeyVersion` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,

    UNIQUE INDEX `relay_channel_probe_profiles_relayChannelId_key`(`relayChannelId`),
    INDEX `relay_channel_probe_profiles_enabled_idx`(`enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relay_channel_probe_runs` (
    `id` VARCHAR(191) NOT NULL,
    `relayChannelId` VARCHAR(191) NOT NULL,
    `profileId` VARCHAR(191) NOT NULL,
    `requestedByUserId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'queued',
    `queuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `leaseOwner` VARCHAR(100) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,
    `distributionMultiplier` DECIMAL(10, 6) NOT NULL,
    `upstreamBalanceBefore` DECIMAL(18, 6) NULL,
    `upstreamBalanceAfter` DECIMAL(18, 6) NULL,
    `upstreamBalanceDelta` DECIMAL(18, 6) NULL,
    `localBalanceBefore` DECIMAL(18, 6) NULL,
    `localBalanceAfter` DECIMAL(18, 6) NULL,
    `localBalanceDelta` DECIMAL(18, 6) NULL,
    `baseLocalCost` DECIMAL(18, 6) NULL,
    `requestTokens` INTEGER NULL,
    `responseTokens` INTEGER NULL,
    `totalTokens` INTEGER NULL,
    `suggestedMultiplier` DECIMAL(10, 6) NULL,
    `sourceChannelMultiplier` DECIMAL(10, 6) NULL,
    `appliedMultiplier` DECIMAL(10, 6) NULL,
    `appliedAt` DATETIME(3) NULL,
    `appliedByUserId` VARCHAR(191) NULL,
    `errorMessage` TEXT NULL,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,

    INDEX `relay_channel_probe_runs_relayChannelId_status_idx`(`relayChannelId`, `status`),
    INDEX `relay_channel_probe_runs_profileId_createTime_idx`(`profileId`, `createTime`),
    INDEX `relay_channel_probe_runs_status_leaseExpiresAt_idx`(`status`, `leaseExpiresAt`),
    INDEX `relay_channel_probe_runs_createTime_idx`(`createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `relay_channel_probe_profiles` ADD CONSTRAINT `relay_channel_probe_profiles_relayChannelId_fkey` FOREIGN KEY (`relayChannelId`) REFERENCES `relay_channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_channel_probe_runs` ADD CONSTRAINT `relay_channel_probe_runs_relayChannelId_fkey` FOREIGN KEY (`relayChannelId`) REFERENCES `relay_channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_channel_probe_runs` ADD CONSTRAINT `relay_channel_probe_runs_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `relay_channel_probe_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

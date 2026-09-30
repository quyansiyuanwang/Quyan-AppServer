-- CreateTable
CREATE TABLE `relay_channel_probe_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `loginWorkflow` JSON NOT NULL,
    `tokenPath` VARCHAR(200) NOT NULL,
    `expiresPath` VARCHAR(200) NULL,
    `expiresMode` VARCHAR(12) NULL,
    `fallbackTtlSeconds` INTEGER NOT NULL,
    `minLoginIntervalSeconds` INTEGER NOT NULL,
    `encryptedCredentials` LONGTEXT NOT NULL,
    `credentialIv` VARCHAR(128) NOT NULL,
    `credentialAuthTag` VARCHAR(128) NOT NULL,
    `lastLoginAttemptAt` DATETIME(3) NULL,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,

    UNIQUE INDEX `relay_channel_probe_accounts_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relay_channel_probe_target_configs` (
    `id` VARCHAR(191) NOT NULL,
    `profileId` VARCHAR(191) NOT NULL,
    `targetChannelId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NULL,
    `probeFormat` VARCHAR(32) NULL,
    `probeModel` VARCHAR(200) NULL,
    `probePayload` JSON NULL,
    `probeGroup` VARCHAR(80) NULL,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,

    INDEX `relay_channel_probe_target_configs_accountId_idx`(`accountId`),
    UNIQUE INDEX `relay_channel_probe_target_configs_profileId_targetChannelId_key`(`profileId`, `targetChannelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `relay_channel_probe_target_configs` ADD CONSTRAINT `relay_channel_probe_target_configs_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `relay_channel_probe_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_channel_probe_target_configs` ADD CONSTRAINT `relay_channel_probe_target_configs_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `relay_channel_probe_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

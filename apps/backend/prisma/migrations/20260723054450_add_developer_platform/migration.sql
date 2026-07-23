-- CreateTable
CREATE TABLE `developer_projects` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `slug` VARCHAR(80) NOT NULL,
    `description` VARCHAR(500) NULL,
    `dailyFreeQuota` INTEGER NOT NULL DEFAULT 1000,
    `overageEnabled` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `developer_projects_slug_key`(`slug`),
    INDEX `developer_projects_userId_status_idx`(`userId`, `status`),
    UNIQUE INDEX `developer_projects_userId_name_key`(`userId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `developer_project_api_keys` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `keyHash` CHAR(64) NOT NULL,
    `keyPrefix` VARCHAR(20) NOT NULL,
    `scopes` JSON NOT NULL,
    `expiresAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `requestCount` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `developer_project_api_keys_keyHash_key`(`keyHash`),
    INDEX `developer_project_api_keys_projectId_status_idx`(`projectId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `developer_kv_entries` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `expiresAt` DATETIME(3) NULL,

    INDEX `developer_kv_entries_projectId_expiresAt_idx`(`projectId`, `expiresAt`),
    UNIQUE INDEX `developer_kv_entries_projectId_key_key`(`projectId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `developer_short_links` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(80) NOT NULL,
    `targetUrl` TEXT NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `expiresAt` DATETIME(3) NULL,
    `clickCount` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `developer_short_links_code_key`(`code`),
    INDEX `developer_short_links_projectId_createTime_idx`(`projectId`, `createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `developer_secrets` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `alias` VARCHAR(100) NOT NULL,
    `ciphertext` TEXT NOT NULL,
    `iv` VARCHAR(64) NOT NULL,
    `authTag` VARCHAR(64) NOT NULL,
    `keyVersion` INTEGER NOT NULL DEFAULT 1,
    `lastUsedAt` DATETIME(3) NULL,

    UNIQUE INDEX `developer_secrets_projectId_alias_key`(`projectId`, `alias`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `developer_verifications` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(20) NOT NULL,
    `recipient` VARCHAR(320) NOT NULL,
    `purpose` VARCHAR(100) NOT NULL,
    `codeHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `remainingTries` INTEGER NOT NULL DEFAULT 5,
    `consumedAt` DATETIME(3) NULL,

    INDEX `developer_verifications_projectId_recipient_purpose_expiresA_idx`(`projectId`, `recipient`, `purpose`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `developer_push_channels` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `type` VARCHAR(30) NOT NULL,
    `endpoint` TEXT NULL,
    `secretAlias` VARCHAR(100) NULL,
    `config` JSON NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    INDEX `developer_push_channels_projectId_enabled_idx`(`projectId`, `enabled`),
    UNIQUE INDEX `developer_push_channels_projectId_name_key`(`projectId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `developer_push_deliveries` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `deliveryStatus` VARCHAR(20) NOT NULL,
    `errorMessage` VARCHAR(500) NULL,

    INDEX `developer_push_deliveries_projectId_createTime_idx`(`projectId`, `createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `developer_status_monitors` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `targetUrl` TEXT NOT NULL,
    `method` VARCHAR(10) NOT NULL DEFAULT 'GET',
    `intervalSec` INTEGER NOT NULL DEFAULT 60,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `lastCheckedAt` DATETIME(3) NULL,
    `lastStatus` VARCHAR(20) NULL,

    INDEX `developer_status_monitors_projectId_enabled_idx`(`projectId`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `developer_quota_usages` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `service` VARCHAR(30) NOT NULL,
    `usageDate` DATE NOT NULL,
    `requestCount` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `developer_quota_usages_projectId_service_usageDate_key`(`projectId`, `service`, `usageDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `developer_projects` ADD CONSTRAINT `developer_projects_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_project_api_keys` ADD CONSTRAINT `developer_project_api_keys_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `developer_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_kv_entries` ADD CONSTRAINT `developer_kv_entries_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `developer_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_short_links` ADD CONSTRAINT `developer_short_links_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `developer_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_secrets` ADD CONSTRAINT `developer_secrets_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `developer_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_verifications` ADD CONSTRAINT `developer_verifications_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `developer_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_push_channels` ADD CONSTRAINT `developer_push_channels_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `developer_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_push_deliveries` ADD CONSTRAINT `developer_push_deliveries_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `developer_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_push_deliveries` ADD CONSTRAINT `developer_push_deliveries_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `developer_push_channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_status_monitors` ADD CONSTRAINT `developer_status_monitors_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `developer_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_quota_usages` ADD CONSTRAINT `developer_quota_usages_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `developer_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE `relay_usages` ADD COLUMN `logicalRequestId` VARCHAR(191) NULL;

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
    `statusPagePublished` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `developer_projects_slug_key`(`slug`),
    INDEX `developer_projects_userId_status_idx`(`userId`, `status`),
    UNIQUE INDEX `developer_projects_userId_name_key`(`userId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `developer_product_configs` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `productCode` VARCHAR(40) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `defaultDailyQuota` INTEGER NOT NULL DEFAULT 0,
    `overagePrice` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `defaultInstanceLimit` INTEGER NOT NULL DEFAULT 1,
    `resourceLimits` JSON NULL,
    `retentionDays` INTEGER NOT NULL DEFAULT 30,
    `settings` JSON NULL,

    UNIQUE INDEX `developer_product_configs_productCode_key`(`productCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `developer_product_entitlements` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `accountOwnerId` VARCHAR(191) NOT NULL,
    `productCode` VARCHAR(40) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `dailyFreeQuota` INTEGER NULL,
    `overageEnabled` BOOLEAN NOT NULL DEFAULT false,
    `instanceLimit` INTEGER NOT NULL DEFAULT 1,
    `startsAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `issuedByUserId` VARCHAR(191) NOT NULL,
    `ownerPolicyId` VARCHAR(191) NULL,

    UNIQUE INDEX `developer_product_entitlements_ownerPolicyId_key`(`ownerPolicyId`),
    INDEX `developer_product_entitlements_productCode_enabled_expiresAt_idx`(`productCode`, `enabled`, `expiresAt`),
    UNIQUE INDEX `developer_product_entitlements_accountOwnerId_productCode_key`(`accountOwnerId`, `productCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `developer_product_instances` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `entitlementId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `slug` VARCHAR(80) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `backingProjectId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `developer_product_instances_backingProjectId_key`(`backingProjectId`),
    INDEX `developer_product_instances_entitlementId_enabled_idx`(`entitlementId`, `enabled`),
    UNIQUE INDEX `developer_product_instances_entitlementId_slug_key`(`entitlementId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `developer_product_api_keys` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `instanceId` VARCHAR(191) NOT NULL,
    `subjectUserId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `keyHash` CHAR(64) NOT NULL,
    `keyPrefix` VARCHAR(20) NOT NULL,
    `actions` JSON NOT NULL,
    `expiresAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `requestCount` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `developer_product_api_keys_keyHash_key`(`keyHash`),
    INDEX `developer_product_api_keys_instanceId_status_idx`(`instanceId`, `status`),
    INDEX `developer_product_api_keys_subjectUserId_status_idx`(`subjectUserId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `developer_product_quota_usages` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `entitlementId` VARCHAR(191) NOT NULL,
    `usageDate` DATE NOT NULL,
    `requestCount` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `developer_product_quota_usages_entitlementId_usageDate_key`(`entitlementId`, `usageDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `developer_product_call_logs` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `entitlementId` VARCHAR(191) NOT NULL,
    `instanceId` VARCHAR(191) NULL,
    `keyId` VARCHAR(191) NULL,
    `subjectUserId` VARCHAR(191) NULL,
    `action` VARCHAR(100) NOT NULL,
    `success` BOOLEAN NOT NULL,
    `errorCode` INTEGER NULL,
    `chargeAmount` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `details` JSON NULL,

    INDEX `developer_product_call_logs_entitlementId_createTime_idx`(`entitlementId`, `createTime`),
    INDEX `developer_product_call_logs_instanceId_createTime_idx`(`instanceId`, `createTime`),
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
CREATE TABLE `developer_short_link_clicks` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `shortLinkId` VARCHAR(191) NOT NULL,
    `clickedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sourceHost` VARCHAR(255) NULL,
    `userAgent` VARCHAR(255) NULL,
    `country` VARCHAR(8) NULL,

    INDEX `developer_short_link_clicks_shortLinkId_clickedAt_idx`(`shortLinkId`, `clickedAt`),
    INDEX `developer_short_link_clicks_country_clickedAt_idx`(`country`, `clickedAt`),
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
    `sourceIpHash` CHAR(64) NULL,
    `codeHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `remainingTries` INTEGER NOT NULL DEFAULT 5,
    `consumedAt` DATETIME(3) NULL,

    INDEX `developer_verifications_projectId_recipient_purpose_expiresA_idx`(`projectId`, `recipient`, `purpose`, `expiresAt`),
    INDEX `developer_verifications_projectId_sourceIpHash_createTime_idx`(`projectId`, `sourceIpHash`, `createTime`),
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
    `content` TEXT NOT NULL,
    `idempotencyKey` VARCHAR(100) NULL,
    `deliveryStatus` VARCHAR(20) NOT NULL,
    `attemptCount` INTEGER NOT NULL DEFAULT 0,
    `nextRetryAt` DATETIME(3) NULL,
    `errorMessage` VARCHAR(500) NULL,

    INDEX `developer_push_deliveries_projectId_createTime_idx`(`projectId`, `createTime`),
    INDEX `developer_push_deliveries_projectId_idempotencyKey_idx`(`projectId`, `idempotencyKey`),
    INDEX `developer_push_deliveries_deliveryStatus_nextRetryAt_idx`(`deliveryStatus`, `nextRetryAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `developer_push_requests` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(100) NOT NULL,
    `requestStatus` VARCHAR(20) NOT NULL DEFAULT 'pending',

    INDEX `developer_push_requests_projectId_createTime_idx`(`projectId`, `createTime`),
    UNIQUE INDEX `developer_push_requests_projectId_idempotencyKey_key`(`projectId`, `idempotencyKey`),
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
    `successStatusCodes` JSON NULL,
    `intervalSec` INTEGER NOT NULL DEFAULT 60,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `lastCheckedAt` DATETIME(3) NULL,
    `lastStatus` VARCHAR(20) NULL,

    INDEX `developer_status_monitors_projectId_enabled_idx`(`projectId`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `developer_status_checks` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `monitorId` VARCHAR(191) NOT NULL,
    `checkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `checkStatus` VARCHAR(20) NOT NULL,
    `statusCode` INTEGER NULL,
    `latencyMs` INTEGER NOT NULL,
    `errorMessage` VARCHAR(500) NULL,

    INDEX `developer_status_checks_monitorId_checkedAt_idx`(`monitorId`, `checkedAt`),
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

-- CreateTable
CREATE TABLE `developer_quota_overrides` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `subjectType` VARCHAR(10) NOT NULL,
    `subjectId` VARCHAR(191) NOT NULL,
    `service` VARCHAR(30) NOT NULL DEFAULT '*',
    `dailyFreeQuota` INTEGER NOT NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdByUserId` VARCHAR(191) NOT NULL,

    INDEX `developer_quota_overrides_subjectType_subjectId_status_expir_idx`(`subjectType`, `subjectId`, `status`, `expiresAt`),
    UNIQUE INDEX `developer_quota_overrides_subjectType_subjectId_service_key`(`subjectType`, `subjectId`, `service`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relay_logical_requests` (
    `id` VARCHAR(191) NOT NULL,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `relayTokenId` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(64) NOT NULL,
    `countedAt` DATETIME(3) NULL,

    INDEX `relay_logical_requests_relayTokenId_countedAt_createTime_idx`(`relayTokenId`, `countedAt`, `createTime`),
    UNIQUE INDEX `relay_logical_requests_relayTokenId_requestId_key`(`relayTokenId`, `requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `relay_usages_logicalRequestId_idx` ON `relay_usages`(`logicalRequestId`);

-- AddForeignKey
ALTER TABLE `developer_projects` ADD CONSTRAINT `developer_projects_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_product_entitlements` ADD CONSTRAINT `developer_product_entitlements_accountOwnerId_fkey` FOREIGN KEY (`accountOwnerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_product_instances` ADD CONSTRAINT `developer_product_instances_entitlementId_fkey` FOREIGN KEY (`entitlementId`) REFERENCES `developer_product_entitlements`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_product_instances` ADD CONSTRAINT `developer_product_instances_backingProjectId_fkey` FOREIGN KEY (`backingProjectId`) REFERENCES `developer_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_product_api_keys` ADD CONSTRAINT `developer_product_api_keys_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `developer_product_instances`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_product_api_keys` ADD CONSTRAINT `developer_product_api_keys_subjectUserId_fkey` FOREIGN KEY (`subjectUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_product_quota_usages` ADD CONSTRAINT `developer_product_quota_usages_entitlementId_fkey` FOREIGN KEY (`entitlementId`) REFERENCES `developer_product_entitlements`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_product_call_logs` ADD CONSTRAINT `developer_product_call_logs_entitlementId_fkey` FOREIGN KEY (`entitlementId`) REFERENCES `developer_product_entitlements`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_project_api_keys` ADD CONSTRAINT `developer_project_api_keys_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `developer_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_kv_entries` ADD CONSTRAINT `developer_kv_entries_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `developer_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_short_links` ADD CONSTRAINT `developer_short_links_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `developer_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_short_link_clicks` ADD CONSTRAINT `developer_short_link_clicks_shortLinkId_fkey` FOREIGN KEY (`shortLinkId`) REFERENCES `developer_short_links`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE `developer_push_requests` ADD CONSTRAINT `developer_push_requests_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `developer_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_status_monitors` ADD CONSTRAINT `developer_status_monitors_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `developer_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_status_checks` ADD CONSTRAINT `developer_status_checks_monitorId_fkey` FOREIGN KEY (`monitorId`) REFERENCES `developer_status_monitors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `developer_quota_usages` ADD CONSTRAINT `developer_quota_usages_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `developer_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_usages` ADD CONSTRAINT `relay_usages_logicalRequestId_fkey` FOREIGN KEY (`logicalRequestId`) REFERENCES `relay_logical_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_logical_requests` ADD CONSTRAINT `relay_logical_requests_relayTokenId_fkey` FOREIGN KEY (`relayTokenId`) REFERENCES `relay_tokens`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

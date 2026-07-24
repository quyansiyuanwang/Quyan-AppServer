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

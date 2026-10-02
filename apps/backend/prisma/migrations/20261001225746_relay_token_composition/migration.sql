-- AlterTable
ALTER TABLE `relay_logical_requests` ADD COLUMN `settledAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `relay_token_member_configs` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `parentTokenId` VARCHAR(191) NOT NULL,
    `tokenId` VARCHAR(191) NOT NULL,
    `priority` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    INDEX `relay_token_member_configs_tokenId_idx`(`tokenId`),
    INDEX `relay_token_member_configs_parentTokenId_priority_idx`(`parentTokenId`, `priority`),
    UNIQUE INDEX `relay_token_member_configs_parentTokenId_tokenId_key`(`parentTokenId`, `tokenId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relay_usage_token_attributions` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `relayUsageId` VARCHAR(191) NOT NULL,
    `relayTokenId` VARCHAR(191) NOT NULL,
    `logicalRequestId` VARCHAR(191) NOT NULL,
    `depth` INTEGER NOT NULL,

    INDEX `relay_usage_token_attributions_relayTokenId_createTime_idx`(`relayTokenId`, `createTime`),
    INDEX `relay_usage_token_attributions_logicalRequestId_idx`(`logicalRequestId`),
    UNIQUE INDEX `relay_usage_token_attributions_relayUsageId_relayTokenId_key`(`relayUsageId`, `relayTokenId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `relay_token_member_configs` ADD CONSTRAINT `relay_token_member_configs_parentTokenId_fkey` FOREIGN KEY (`parentTokenId`) REFERENCES `relay_tokens`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_token_member_configs` ADD CONSTRAINT `relay_token_member_configs_tokenId_fkey` FOREIGN KEY (`tokenId`) REFERENCES `relay_tokens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_usage_token_attributions` ADD CONSTRAINT `relay_usage_token_attributions_relayUsageId_fkey` FOREIGN KEY (`relayUsageId`) REFERENCES `relay_usages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_usage_token_attributions` ADD CONSTRAINT `relay_usage_token_attributions_relayTokenId_fkey` FOREIGN KEY (`relayTokenId`) REFERENCES `relay_tokens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_usage_token_attributions` ADD CONSTRAINT `relay_usage_token_attributions_logicalRequestId_fkey` FOREIGN KEY (`logicalRequestId`) REFERENCES `relay_logical_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

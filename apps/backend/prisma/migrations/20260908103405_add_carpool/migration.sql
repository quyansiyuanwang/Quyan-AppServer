/*
  Warnings:

  - A unique constraint covering the columns `[carpoolMemberId]` on the table `relay_tokens` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `relay_tokens` ADD COLUMN `carpoolMemberId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `carpool_package_templates` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `publishStatus` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `publishedAt` DATETIME(3) NULL,
    `salePrice` DECIMAL(10, 4) NOT NULL,
    `upstreamCost` DECIMAL(10, 4) NOT NULL,
    `maxMembers` INTEGER NOT NULL,
    `monthlyPassTemplateId` VARCHAR(191) NOT NULL,
    `snapshotQuota` DECIMAL(10, 4) NOT NULL,
    `snapshotValidityDays` INTEGER NOT NULL,
    `snapshotQuotaUnit` VARCHAR(20) NOT NULL DEFAULT 'amount',
    `snapshotQuotaWindowHours` INTEGER NULL,
    `snapshotAllowedModels` TEXT NULL,
    `snapshotAllowedChannels` TEXT NULL,

    UNIQUE INDEX `carpool_package_templates_name_key`(`name`),
    INDEX `carpool_package_templates_status_publishStatus_idx`(`status`, `publishStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `carpool_orders` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `ownerUserId` VARCHAR(191) NOT NULL,
    `packageTemplateId` VARCHAR(191) NOT NULL,
    `state` VARCHAR(20) NOT NULL DEFAULT 'open',
    `packageName` VARCHAR(191) NOT NULL,
    `salePrice` DECIMAL(10, 4) NOT NULL,
    `upstreamCost` DECIMAL(10, 4) NOT NULL,
    `maxMembers` INTEGER NOT NULL,
    `totalQuota` DECIMAL(10, 4) NOT NULL,
    `validityDays` INTEGER NOT NULL,
    `quotaUnit` VARCHAR(20) NOT NULL DEFAULT 'amount',
    `quotaWindowHours` INTEGER NULL,
    `allowedModels` TEXT NULL,
    `allowedChannels` TEXT NULL,
    `inviteExpiresAt` DATETIME(3) NULL,
    `relayChannelId` VARCHAR(191) NULL,
    `submittedAt` DATETIME(3) NULL,
    `acceptedAt` DATETIME(3) NULL,
    `fulfilledAt` DATETIME(3) NULL,
    `failedAt` DATETIME(3) NULL,
    `failureReason` TEXT NULL,

    INDEX `carpool_orders_ownerUserId_state_idx`(`ownerUserId`, `state`),
    INDEX `carpool_orders_state_createTime_idx`(`state`, `createTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `carpool_members` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(20) NOT NULL DEFAULT 'member',
    `state` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `paymentRatio` DECIMAL(8, 6) NOT NULL DEFAULT 0,
    `quotaRatio` DECIMAL(8, 6) NOT NULL DEFAULT 0,
    `payableAmount` DECIMAL(10, 4) NOT NULL DEFAULT 0,
    `finalQuota` DECIMAL(10, 4) NOT NULL DEFAULT 0,
    `confirmedAt` DATETIME(3) NULL,
    `userMonthlyPassId` VARCHAR(191) NULL,

    UNIQUE INDEX `carpool_members_userMonthlyPassId_key`(`userMonthlyPassId`),
    INDEX `carpool_members_userId_state_idx`(`userId`, `state`),
    UNIQUE INDEX `carpool_members_orderId_userId_key`(`orderId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `carpool_invites` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `createdByUserId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(128) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `usedByUserId` VARCHAR(191) NULL,
    `usedAt` DATETIME(3) NULL,

    UNIQUE INDEX `carpool_invites_tokenHash_key`(`tokenHash`),
    INDEX `carpool_invites_orderId_expiresAt_idx`(`orderId`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `balance_reservations` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `memberId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 4) NOT NULL,
    `state` VARCHAR(20) NOT NULL DEFAULT 'reserved',

    UNIQUE INDEX `balance_reservations_memberId_key`(`memberId`),
    INDEX `balance_reservations_userId_state_idx`(`userId`, `state`),
    INDEX `balance_reservations_orderId_state_idx`(`orderId`, `state`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `relay_tokens_carpoolMemberId_key` ON `relay_tokens`(`carpoolMemberId`);

-- CreateIndex
CREATE INDEX `relay_tokens_carpoolMemberId_idx` ON `relay_tokens`(`carpoolMemberId`);

-- AddForeignKey
ALTER TABLE `relay_tokens` ADD CONSTRAINT `relay_tokens_carpoolMemberId_fkey` FOREIGN KEY (`carpoolMemberId`) REFERENCES `carpool_members`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_package_templates` ADD CONSTRAINT `carpool_package_templates_monthlyPassTemplateId_fkey` FOREIGN KEY (`monthlyPassTemplateId`) REFERENCES `monthly_pass_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_orders` ADD CONSTRAINT `carpool_orders_ownerUserId_fkey` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_orders` ADD CONSTRAINT `carpool_orders_packageTemplateId_fkey` FOREIGN KEY (`packageTemplateId`) REFERENCES `carpool_package_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_orders` ADD CONSTRAINT `carpool_orders_relayChannelId_fkey` FOREIGN KEY (`relayChannelId`) REFERENCES `relay_channels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_members` ADD CONSTRAINT `carpool_members_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_members` ADD CONSTRAINT `carpool_members_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `carpool_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_members` ADD CONSTRAINT `carpool_members_userMonthlyPassId_fkey` FOREIGN KEY (`userMonthlyPassId`) REFERENCES `user_monthly_passes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_invites` ADD CONSTRAINT `carpool_invites_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `carpool_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_invites` ADD CONSTRAINT `carpool_invites_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_invites` ADD CONSTRAINT `carpool_invites_usedByUserId_fkey` FOREIGN KEY (`usedByUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `balance_reservations` ADD CONSTRAINT `balance_reservations_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `balance_reservations` ADD CONSTRAINT `balance_reservations_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `carpool_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `balance_reservations` ADD CONSTRAINT `balance_reservations_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `carpool_members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

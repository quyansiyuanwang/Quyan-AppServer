-- AlterTable
ALTER TABLE `relay_channels` ADD COLUMN `channelType` VARCHAR(30) NOT NULL DEFAULT 'standalone',
    ADD COLUMN `routingConfig` JSON NULL,
    ADD COLUMN `routingStrategy` VARCHAR(30) NOT NULL DEFAULT 'priority',
    ADD COLUMN `visibilityConfig` JSON NULL,
    ADD COLUMN `visibilityMode` VARCHAR(30) NOT NULL DEFAULT 'public';

-- CreateTable
CREATE TABLE `relay_channel_members` (
    `id` VARCHAR(191) NOT NULL,
    `relayChannelId` VARCHAR(191) NOT NULL,
    `memberChannelId` VARCHAR(191) NOT NULL,
    `priority` INTEGER NOT NULL,
    `weight` DECIMAL(10, 6) NOT NULL DEFAULT 1.0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,

    INDEX `relay_channel_members_relayChannelId_priority_idx`(`relayChannelId`, `priority`),
    INDEX `relay_channel_members_memberChannelId_idx`(`memberChannelId`),
    UNIQUE INDEX `relay_channel_members_relayChannelId_memberChannelId_key`(`relayChannelId`, `memberChannelId`),
    UNIQUE INDEX `relay_channel_members_relayChannelId_priority_key`(`relayChannelId`, `priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `relay_channel_members` ADD CONSTRAINT `relay_channel_members_relayChannelId_fkey` FOREIGN KEY (`relayChannelId`) REFERENCES `relay_channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relay_channel_members` ADD CONSTRAINT `relay_channel_members_memberChannelId_fkey` FOREIGN KEY (`memberChannelId`) REFERENCES `relay_channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

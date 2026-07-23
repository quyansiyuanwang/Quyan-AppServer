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

-- AddForeignKey
ALTER TABLE `developer_short_link_clicks` ADD CONSTRAINT `developer_short_link_clicks_shortLinkId_fkey` FOREIGN KEY (`shortLinkId`) REFERENCES `developer_short_links`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

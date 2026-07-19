-- AlterTable
ALTER TABLE `relay_tokens` ADD COLUMN `automaticProxyPoolChannelId` VARCHAR(191) NULL,
    ADD COLUMN `routingMode` VARCHAR(30) NOT NULL DEFAULT 'ordered';

-- CreateIndex
CREATE INDEX `relay_tokens_automaticProxyPoolChannelId_idx` ON `relay_tokens`(`automaticProxyPoolChannelId`);

-- AddForeignKey
ALTER TABLE `relay_tokens` ADD CONSTRAINT `relay_tokens_automaticProxyPoolChannelId_fkey` FOREIGN KEY (`automaticProxyPoolChannelId`) REFERENCES `relay_channels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

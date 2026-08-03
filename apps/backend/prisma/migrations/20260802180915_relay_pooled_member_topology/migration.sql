-- AlterTable
ALTER TABLE `relay_channels` ADD COLUMN `pooledMemberEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `pooledParentId` VARCHAR(191) NULL,
    ADD COLUMN `pooledPriority` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `pooledWeight` DECIMAL(10, 6) NOT NULL DEFAULT 1.0;

-- AlterTable
ALTER TABLE `relay_configs` ADD COLUMN `channelTopologyMode` VARCHAR(30) NOT NULL DEFAULT 'legacy';

-- CreateIndex
CREATE INDEX `relay_channels_pooledParentId_pooledPriority_idx` ON `relay_channels`(`pooledParentId`, `pooledPriority`);

-- AddForeignKey
ALTER TABLE `relay_channels` ADD CONSTRAINT `relay_channels_pooledParentId_fkey` FOREIGN KEY (`pooledParentId`) REFERENCES `relay_channels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE `relay_channel_probe_runs` DROP FOREIGN KEY `relay_channel_probe_runs_profileId_fkey`;

-- AlterTable
ALTER TABLE `relay_channel_probe_runs` MODIFY `profileId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `relay_channel_probe_runs` ADD CONSTRAINT `relay_channel_probe_runs_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `relay_channel_probe_profiles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

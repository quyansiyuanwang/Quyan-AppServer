-- AlterTable
ALTER TABLE `relay_channel_probe_runs` ADD COLUMN `probeMemberChannelId` VARCHAR(191) NULL,
    ADD COLUMN `probeMemberChannelName` VARCHAR(100) NULL;

-- CreateIndex
CREATE INDEX `relay_channel_probe_runs_relayChannelId_probeMemberChannelId_idx` ON `relay_channel_probe_runs`(`relayChannelId`, `probeMemberChannelId`, `status`);

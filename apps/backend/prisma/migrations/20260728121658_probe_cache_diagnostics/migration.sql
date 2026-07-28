-- AlterTable
ALTER TABLE `relay_channel_probe_profiles` ADD COLUMN `preventCache` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `relay_channel_probe_runs` ADD COLUMN `cacheBusterId` VARCHAR(36) NULL,
    ADD COLUMN `cacheBustingEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `cacheCreationTokens` INTEGER NULL,
    ADD COLUMN `cacheReadTokens` INTEGER NULL,
    ADD COLUMN `costBreakdown` JSON NULL,
    ADD COLUMN `forceWithoutCacheBuster` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `upstreamUsage` JSON NULL;

-- AlterTable
ALTER TABLE `relay_channel_probe_profiles` ADD COLUMN `upstreamRateMultiplier` DECIMAL(10, 6) NOT NULL DEFAULT 1.0;

-- AlterTable
ALTER TABLE `relay_channel_probe_runs` ADD COLUMN `upstreamRateMultiplier` DECIMAL(10, 6) NOT NULL DEFAULT 1.0;

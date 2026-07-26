-- AlterTable
ALTER TABLE `relay_channel_probe_profiles` ADD COLUMN `upstreamBalanceDivisor` DECIMAL(18, 6) NOT NULL DEFAULT 1.0;

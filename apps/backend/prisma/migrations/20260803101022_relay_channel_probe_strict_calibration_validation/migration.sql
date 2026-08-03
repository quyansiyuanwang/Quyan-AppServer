-- AlterTable
ALTER TABLE `relay_channel_probe_profiles` ADD COLUMN `strictCalibrationValidation` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `relay_channel_probe_runs` ADD COLUMN `strictCalibrationValidation` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `relay_probe_rounds` ADD COLUMN `errorCode` VARCHAR(100) NULL,
    ADD COLUMN `errorStage` VARCHAR(40) NULL;

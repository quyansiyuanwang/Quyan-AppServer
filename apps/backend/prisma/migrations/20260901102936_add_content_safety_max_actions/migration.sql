-- AlterTable
ALTER TABLE `content_safety_user_configs` ADD COLUMN `requestAiAction` VARCHAR(20) NULL,
    ADD COLUMN `requestMaxAction` VARCHAR(20) NULL,
    ADD COLUMN `responseAiAction` VARCHAR(20) NULL,
    ADD COLUMN `responseMaxAction` VARCHAR(20) NULL;

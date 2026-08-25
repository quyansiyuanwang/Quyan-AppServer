-- AlterTable
ALTER TABLE `content_safety_incidents`
    ADD COLUMN `matchContext` VARCHAR(720) NULL,
    ADD COLUMN `matchText` VARCHAR(240) NULL;

-- AlterTable
ALTER TABLE `developer_status_monitors` ADD COLUMN `requestBody` TEXT NULL,
    ADD COLUMN `responseBodyMatch` TEXT NULL,
    ADD COLUMN `responseBodyMatchMode` VARCHAR(20) NULL;

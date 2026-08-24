-- AlterTable
ALTER TABLE `developer_status_monitors` ADD COLUMN `alertDelayMinutes` INTEGER NOT NULL DEFAULT 5,
    ADD COLUMN `downAlertedAt` DATETIME(3) NULL,
    ADD COLUMN `downSinceAt` DATETIME(3) NULL;

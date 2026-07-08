-- AlterTable
ALTER TABLE `notification_inbox_items` ADD COLUMN `pixelOpened` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `pixelOpenedTime` DATETIME(3) NULL,
    ADD COLUMN `readSource` VARCHAR(20) NULL;

-- CreateIndex
CREATE INDEX `notification_inbox_items_userId_pixelOpened_isRead_idx` ON `notification_inbox_items`(`userId`, `pixelOpened`, `isRead`);

/*
  Warnings:

  - A unique constraint covering the columns `[developerProductInstanceId]` on the table `json_endpoints` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `json_endpoints` ADD COLUMN `developerProductInstanceId` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `json_endpoints_developerProductInstanceId_key` ON `json_endpoints`(`developerProductInstanceId`);

-- AddForeignKey
ALTER TABLE `json_endpoints` ADD CONSTRAINT `json_endpoints_developerProductInstanceId_fkey` FOREIGN KEY (`developerProductInstanceId`) REFERENCES `developer_product_instances`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

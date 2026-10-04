/*
  Warnings:

  - A unique constraint covering the columns `[legacyKey]` on the table `access_keys` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[legacyKeyHash]` on the table `developer_product_api_keys` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[legacyKeyHash]` on the table `developer_project_api_keys` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[legacyKey]` on the table `oj_api_keys` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[legacyToken]` on the table `relay_tokens` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `access_keys` ADD COLUMN `legacyKey` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `developer_product_api_keys` ADD COLUMN `legacyKeyHash` CHAR(64) NULL;

-- AlterTable
ALTER TABLE `developer_project_api_keys` ADD COLUMN `legacyKeyHash` CHAR(64) NULL;

-- AlterTable
ALTER TABLE `oj_api_keys` ADD COLUMN `legacyKey` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `relay_tokens` ADD COLUMN `legacyToken` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `access_keys_legacyKey_key` ON `access_keys`(`legacyKey`);

-- CreateIndex
CREATE UNIQUE INDEX `developer_product_api_keys_legacyKeyHash_key` ON `developer_product_api_keys`(`legacyKeyHash`);

-- CreateIndex
CREATE UNIQUE INDEX `developer_project_api_keys_legacyKeyHash_key` ON `developer_project_api_keys`(`legacyKeyHash`);

-- CreateIndex
CREATE UNIQUE INDEX `oj_api_keys_legacyKey_key` ON `oj_api_keys`(`legacyKey`);

-- CreateIndex
CREATE UNIQUE INDEX `relay_tokens_legacyToken_key` ON `relay_tokens`(`legacyToken`);

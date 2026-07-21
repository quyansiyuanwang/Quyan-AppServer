/*
  Warnings:

  - A unique constraint covering the columns `[rootSlug]` on the table `json_endpoints` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,slug]` on the table `json_endpoints` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX `json_endpoints_slug_key` ON `json_endpoints`;

-- AlterTable
ALTER TABLE `json_endpoints` ADD COLUMN `isRootSlug` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `rootSlug` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `json_endpoints_rootSlug_key` ON `json_endpoints`(`rootSlug`);

-- CreateIndex
CREATE UNIQUE INDEX `json_endpoints_userId_slug_key` ON `json_endpoints`(`userId`, `slug`);

/*
  Warnings:

  - You are about to drop the column `loginWorkflow` on the `relay_channel_probe_accounts` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `relay_channel_probe_accounts` DROP COLUMN `loginWorkflow`;

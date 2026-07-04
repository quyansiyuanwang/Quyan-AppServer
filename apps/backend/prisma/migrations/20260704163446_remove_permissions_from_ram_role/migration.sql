-- Drop permissions column from ram_roles (role permissions now come from RamPolicyAttachment)
ALTER TABLE `ram_roles` DROP COLUMN `permissions`;

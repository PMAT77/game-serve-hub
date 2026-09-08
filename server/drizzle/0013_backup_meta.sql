ALTER TABLE `backups` ADD COLUMN `kind` text NOT NULL DEFAULT 'manual';
ALTER TABLE `backups` ADD COLUMN `status` text NOT NULL DEFAULT 'completed';
ALTER TABLE `backups` ADD COLUMN `shards` text;
ALTER TABLE `backups` ADD COLUMN `created_by` text NOT NULL DEFAULT '';

ALTER TABLE `instance_mods` ADD COLUMN `install_status` text NOT NULL DEFAULT 'ready';
ALTER TABLE `instance_mods` ADD COLUMN `install_error` text;

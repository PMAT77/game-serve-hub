ALTER TABLE `backups` ADD `kind` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `backups` ADD `status` text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE `backups` ADD `shards` text;--> statement-breakpoint
ALTER TABLE `backups` ADD `created_by` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `instance_mods` ADD `config` text;
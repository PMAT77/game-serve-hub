ALTER TABLE `game_instances` ADD `update_available` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `game_instances` ADD `local_build_id` text;
--> statement-breakpoint
ALTER TABLE `game_instances` ADD `remote_build_id` text;
--> statement-breakpoint
ALTER TABLE `game_instances` ADD `update_checked_at` text;

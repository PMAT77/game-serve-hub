ALTER TABLE `game_instances` ADD `runtime_pid` integer;
--> statement-breakpoint
ALTER TABLE `game_instances` ADD `last_command` text;
--> statement-breakpoint
ALTER TABLE `game_instances` ADD `last_exit_code` integer;
--> statement-breakpoint
ALTER TABLE `game_instances` ADD `last_error` text;

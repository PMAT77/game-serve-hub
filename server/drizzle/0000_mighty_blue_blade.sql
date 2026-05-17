CREATE TABLE IF NOT EXISTS `auth_sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `backups` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`file_path` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `game_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`name` text NOT NULL,
	`game_code` text NOT NULL,
	`status` text DEFAULT 'stopped' NOT NULL,
	`container_id` text,
	`install_path` text,
	`config_path` text,
	`query_port` integer,
	`game_port` integer,
	`rcon_port` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `instance_mods` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`workshop_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`load_order` integer DEFAULT 0 NOT NULL,
	`version` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `server_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`ssh_port` integer DEFAULT 22 NOT NULL,
	`status` text DEFAULT 'offline' NOT NULL,
	`cpu_usage` real DEFAULT 0 NOT NULL,
	`memory_usage` real DEFAULT 0 NOT NULL,
	`disk_usage` real DEFAULT 0 NOT NULL,
	`last_heartbeat_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `system_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_permissions` (
	`user_id` text NOT NULL,
	`permission` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `permission`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `users` (
	`id` text PRIMARY KEY NOT NULL,
	`account` text NOT NULL,
	`password_hash` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`avatar` text DEFAULT '' NOT NULL,
	`status` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_account_unique` ON `users` (`account`);
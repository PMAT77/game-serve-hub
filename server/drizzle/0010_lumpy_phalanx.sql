-- 0010：补账历史影子迁移，使 drizzle 迁移重新成为唯一事实来源。
-- - auth_sessions 7 列 / game_instances 12 列 / users.must_change_password：老库可能已由
--   connection.ts 运行时 ensureColumn 补齐，重复 ADD 由执行层吞掉 duplicate column 错误。
-- - instance_mods：重建表把 enabled 默认值从 1 修正为 0（与 schema 一致），已有行数据原样保留。
-- - instance_maintenance_*：部分老库可能缺失，IF NOT EXISTS 保证幂等。
CREATE TABLE IF NOT EXISTS `instance_maintenance_drafts` (
	`instance_id` text PRIMARY KEY NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `instance_maintenance_push_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`message` text NOT NULL,
	`operator_account` text NOT NULL,
	`status` text NOT NULL,
	`error_message` text,
	`pushed_at` text NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_instance_mods` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`workshop_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`load_order` integer DEFAULT 0 NOT NULL,
	`version` text,
	`preview_image` text,
	`install_status` text DEFAULT 'ready' NOT NULL,
	`install_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_instance_mods`("id", "instance_id", "workshop_id", "name", "enabled", "load_order", "version", "preview_image", "install_status", "install_error", "created_at", "updated_at") SELECT "id", "instance_id", "workshop_id", "name", "enabled", "load_order", "version", "preview_image", "install_status", "install_error", "created_at", "updated_at" FROM `instance_mods`;--> statement-breakpoint
DROP TABLE `instance_mods`;--> statement-breakpoint
ALTER TABLE `__new_instance_mods` RENAME TO `instance_mods`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `token_hash` text;--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `refresh_token_hash` text;--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `expires_at` text;--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `refresh_expires_at` text;--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `rotated_at` text;--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `last_seen_ip` text;--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `user_agent` text;--> statement-breakpoint
ALTER TABLE `game_instances` ADD `runtime_pid` integer;--> statement-breakpoint
ALTER TABLE `game_instances` ADD `runtime_started_at` text;--> statement-breakpoint
ALTER TABLE `game_instances` ADD `last_command` text;--> statement-breakpoint
ALTER TABLE `game_instances` ADD `last_exit_code` integer;--> statement-breakpoint
ALTER TABLE `game_instances` ADD `last_error` text;--> statement-breakpoint
ALTER TABLE `game_instances` ADD `install_log_status` text;--> statement-breakpoint
ALTER TABLE `game_instances` ADD `install_percent` integer;--> statement-breakpoint
ALTER TABLE `game_instances` ADD `install_log_updated_at` text;--> statement-breakpoint
ALTER TABLE `game_instances` ADD `update_available` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `game_instances` ADD `local_build_id` text;--> statement-breakpoint
ALTER TABLE `game_instances` ADD `remote_build_id` text;--> statement-breakpoint
ALTER TABLE `game_instances` ADD `update_checked_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `must_change_password` integer DEFAULT 0 NOT NULL;
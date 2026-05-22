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
CREATE INDEX IF NOT EXISTS `instance_maintenance_push_logs_instance_id_pushed_at_idx` ON `instance_maintenance_push_logs` (`instance_id`, `pushed_at` DESC);

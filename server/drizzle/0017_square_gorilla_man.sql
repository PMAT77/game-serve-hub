CREATE TABLE `notify_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`health_status` text DEFAULT 'healthy' NOT NULL,
	`last_error_at` text,
	`last_error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);

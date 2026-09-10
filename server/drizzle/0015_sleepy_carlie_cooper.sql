CREATE TABLE `scheduled_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`kind` text NOT NULL,
	`schedule_type` text NOT NULL,
	`schedule_value` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`last_run_at` text,
	`last_run_status` text,
	`last_run_message` text,
	`next_run_at` text,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);

CREATE TABLE `instance_player_profiles` (
	`instance_id` text NOT NULL,
	`ku_id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`instance_id`, `ku_id`)
);

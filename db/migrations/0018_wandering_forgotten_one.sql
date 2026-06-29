CREATE TABLE `deployments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` text NOT NULL,
	`commit_hash` text,
	`commit_short` text,
	`branch` text,
	`tag` text,
	`is_dirty` integer DEFAULT 0,
	`build_time` text,
	`deployed_at` integer NOT NULL,
	`deployed_by` text,
	`node_version` text,
	`environment` text DEFAULT 'production'
);
--> statement-breakpoint
CREATE INDEX `idx_deployments_deployed_at` ON `deployments` (`deployed_at`);--> statement-breakpoint
CREATE INDEX `idx_deployments_version` ON `deployments` (`version`);

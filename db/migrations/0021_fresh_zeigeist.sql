CREATE TABLE `backlog_overlap_flags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workflow_id` text NOT NULL,
	`item_id` text NOT NULL,
	`feature_key_a` text NOT NULL,
	`story_id_a` text NOT NULL,
	`feature_key_b` text NOT NULL,
	`story_id_b` text NOT NULL,
	`score` real NOT NULL,
	`matched_terms` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`resolved_by_user_id` integer,
	`resolved_at` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_backlog_overlap_flags_workflow` ON `backlog_overlap_flags` (`workflow_id`);
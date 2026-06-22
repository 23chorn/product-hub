CREATE TABLE `kb_repos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`repository` text NOT NULL,
	`branch` text,
	`created_by_user_id` integer,
	`last_synced_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_kb_repos_repository` ON `kb_repos` (`repository`);
--> statement-breakpoint
CREATE TABLE `kb_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`path` text NOT NULL,
	`frontmatter_file_name` text,
	`frontmatter_owner` text,
	`frontmatter_status` text,
	`frontmatter_valid` integer DEFAULT 0 NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`commit_id` text,
	`last_synced_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `kb_repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_kb_files_repo_path` ON `kb_files` (`repo_id`,`path`);
--> statement-breakpoint
CREATE INDEX `idx_kb_files_owner` ON `kb_files` (`frontmatter_owner`);
--> statement-breakpoint
CREATE INDEX `idx_kb_files_status` ON `kb_files` (`frontmatter_status`);
--> statement-breakpoint
CREATE TABLE `kb_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_id` integer NOT NULL,
	`source` text NOT NULL,
	`author_user_id` integer,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`quote` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`resolved_by_user_id` integer,
	FOREIGN KEY (`file_id`) REFERENCES `kb_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_kb_comments_file` ON `kb_comments` (`file_id`);

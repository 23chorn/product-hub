CREATE TABLE `swagger_api_docs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`doc_url` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`spec_title` text,
	`spec_version` text,
	`content` text,
	`last_synced_at` integer,
	`last_sync_error` text,
	`created_by_user_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_swagger_api_docs_url` ON `swagger_api_docs` (`doc_url`);
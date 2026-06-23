DROP TABLE `skill_versions`;--> statement-breakpoint
DROP TABLE `workflow_skill_assignments`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`type` text NOT NULL,
	`file_path` text DEFAULT '' NOT NULL,
	`external_url` text,
	`wiki_path` text,
	`wiki_url` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_artifacts`("id", "session_id", "type", "file_path", "external_url", "wiki_path", "wiki_url", "status", "created_at") SELECT "id", "session_id", "type", "file_path", "external_url", "wiki_path", "wiki_url", "status", "created_at" FROM `artifacts`;--> statement-breakpoint
DROP TABLE `artifacts`;--> statement-breakpoint
ALTER TABLE `__new_artifacts` RENAME TO `artifacts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_artifacts_session` ON `artifacts` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_artifacts_type` ON `artifacts` (`type`);
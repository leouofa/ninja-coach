CREATE TABLE `embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `embeddings_source_idx` ON `embeddings` (`source_type`,`source_id`);
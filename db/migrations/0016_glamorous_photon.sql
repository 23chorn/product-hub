ALTER TABLE `items` ADD `seq_num` integer;--> statement-breakpoint
UPDATE items SET seq_num = (
  SELECT rn FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn FROM items
  ) ranked WHERE ranked.id = items.id
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_items_seq_num` ON `items` (`seq_num`);
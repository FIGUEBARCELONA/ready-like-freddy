ALTER TABLE `visual_assets` ADD `rightsReviewedByOpenId` varchar(64);--> statement-breakpoint
ALTER TABLE `visual_assets` ADD `rightsReviewedAt` timestamp;--> statement-breakpoint
ALTER TABLE `visual_assets` ADD `rightsReviewReason` text;
CREATE TABLE `research_partitions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workstreamId` varchar(3) NOT NULL,
	`partitionType` enum('OFFICIAL_URL_PREFIX','PRODUCT_CODE_FAMILY','MODEL_FAMILY','HISTORICAL_WINDOW','CONTENT_CLASS','CUSTOM') NOT NULL,
	`partitionKey` varchar(191) NOT NULL,
	`scopeFingerprint` varchar(64) NOT NULL,
	`canonicalDescriptor` text NOT NULL,
	`status` enum('RESERVED','ACTIVE','BLOCKED','RETIRED') NOT NULL DEFAULT 'RESERVED',
	`createdByOpenId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`retiredAt` timestamp,
	CONSTRAINT `research_partitions_id` PRIMARY KEY(`id`),
	CONSTRAINT `research_partitions_workstreamId_unique` UNIQUE(`workstreamId`),
	CONSTRAINT `research_partitions_partitionKey_unique` UNIQUE(`partitionKey`),
	CONSTRAINT `research_partitions_scopeFingerprint_unique` UNIQUE(`scopeFingerprint`)
);
--> statement-breakpoint
CREATE TABLE `research_scope_claims` (
	`id` int AUTO_INCREMENT NOT NULL,
	`researchPartitionId` int NOT NULL,
	`claimType` enum('OFFICIAL_URL','PRODUCT_CODE','MODEL_NAME','COLOUR_NAME','FACTORY_CLAIM','ARTICLE_SLUG') NOT NULL,
	`canonicalValue` varchar(512) NOT NULL,
	`claimFingerprint` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `research_scope_claims_id` PRIMARY KEY(`id`),
	CONSTRAINT `research_scope_claims_claimFingerprint_unique` UNIQUE(`claimFingerprint`)
);
--> statement-breakpoint
ALTER TABLE `research_partitions` ADD CONSTRAINT `research_partitions_workstreamId_workstreams_id_fk` FOREIGN KEY (`workstreamId`) REFERENCES `workstreams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `research_scope_claims` ADD CONSTRAINT `rsc_partition_fk` FOREIGN KEY (`researchPartitionId`) REFERENCES `research_partitions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `research_partitions_status_idx` ON `research_partitions` (`status`);--> statement-breakpoint
CREATE INDEX `research_scope_claims_partition_idx` ON `research_scope_claims` (`researchPartitionId`);--> statement-breakpoint
CREATE INDEX `research_scope_claims_type_value_idx` ON `research_scope_claims` (`claimType`,`canonicalValue`);
